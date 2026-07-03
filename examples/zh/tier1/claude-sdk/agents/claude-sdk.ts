// claude-sdk 的 adapter:黑盒对接一个**已经在跑**的应用(../src/backend/server.ts,原生
// `SDKMessage` 流原样透传成 SSE,外加自定义 { type: "server_error" } 传输帧)。
//
// `SDKMessage` → 标准事件的映射是官方转换器 `fromClaudeSdkMessages`(`"niceeval/adapter"`
// 导出)的事;这里只剩传输粘合:端点在哪、审批打哪个端点、HITL 停轮怎么判。
// 无 OTel(CLI 原生遥测只有 metrics+logs,niceeval 不消费),事件全部来自转换器。
//
// HITL 没有显式的"等审批"帧——`canUseTool` 把流卡在一个 Promise 上,客户端只能从
// "gated 工具的 tool_use 到了、之后没动静"推断。Tier 1 的确定性做法:被门控的工具就
// mcp__demo-tools__calculate 一个(应用 agent.ts 里的 GATED_TOOL_NAME,这里必须写死同一个
// 字符串),转换器吐出它的 action.called 就按审批点处理:挂起还开着的流、返回 waiting;
// 下一轮先打 /api/chat/approve 再继续读同一条流。
import { defineAgent, sseJsonFrames, fromClaudeSdkMessages } from "niceeval/adapter";
import type { AgentContext, ClaudeSdkStream, SseFrameCursor } from "niceeval/adapter";
import type { StreamEvent, Turn, TurnInput } from "niceeval";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// 必须和 ../src/backend/agent.ts 里的 GATED_TOOL_NAME 完全一致(MCP 命名空间下的真实工具名)。
const GATED_TOOL_NAME = "mcp__demo-tools__calculate";

// 被测应用由你自己按它的方式启动(pnpm start / 部署在哪都行),eval 不代管进程、不另开端口。
const BASE_URL = process.env.CLAUDE_SDK_URL ?? "http://127.0.0.1:5189";

type TransportFrame = { type: "server_error"; message: string };
type ClaudeFrame = SDKMessage | TransportFrame;

async function appFetch(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new Error(
      `连不上 ${BASE_URL}${path}。被测应用在跑吗?先起它:cd examples/zh/tier1/claude-sdk && pnpm start(或设 CLAUDE_SDK_URL 指向已部署实例)。`,
    );
  }
}

// sessionId -> 还开着的流(+ 转换器状态,续读要接着用同一个:去重集合、usage 都在里面)。
interface PendingApproval {
  readonly cursor: SseFrameCursor<ClaudeFrame>;
  readonly stream: ClaudeSdkStream;
  readonly toolUseId: string;
}
const pendingApprovals = new Map<string, PendingApproval>();

async function drainStream(cursor: SseFrameCursor<ClaudeFrame>, ctx: AgentContext, stream: ClaudeSdkStream): Promise<Turn> {
  const events: StreamEvent[] = [];
  let transportFailed = false;

  for (;;) {
    const frame = await cursor.next();
    if (frame === null) break;

    if (frame.type === "server_error") {
      transportFailed = true;
      events.push({ type: "error", message: (frame as TransportFrame).message });
      continue;
    }

    const derived = stream.add(frame);
    events.push(...derived);
    if (ctx.session.isNew && !ctx.session.id && stream.sessionId) ctx.session.id = stream.sessionId;

    // HITL 停轮:gated 工具的 tool_use 到了(canUseTool 此刻把流卡住,不会再有后续帧)。
    const gated = derived.find((e) => e.type === "action.called" && e.name === GATED_TOOL_NAME);
    if (gated && gated.type === "action.called") {
      if (!ctx.session.id) throw new Error("gated tool_use 到达时 ctx.session.id 还没写回");
      pendingApprovals.set(ctx.session.id, { cursor, stream, toolUseId: gated.callId });
      events.push({
        type: "input.requested",
        request: { id: gated.callId, action: GATED_TOOL_NAME, options: [{ id: "approve" }, { id: "deny" }] },
      });
      return { status: "waiting", events, usage: stream.usage };
    }
  }

  return { status: transportFailed || stream.failed ? "failed" : "completed", events, usage: stream.usage };
}

/**
 * approve 端点在极少数情况下会在 canUseTool 真正把 resolver 存进服务端 pendingApprovals 之前
 * 就被我们打到——tool_use 块本身是"模型已经决定调用"的证据,但 SDK 内部要再过几十毫秒才跑到
 * canUseTool 回调去注册 resolver。404 大概率是这个注册竞态,不是真的没有这次审批,短退避重试
 * 几次;其它状态码直接抛。
 */
async function postApprove(toolUseId: string, approved: boolean, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const res = await appFetch("/api/chat/approve", { toolUseId, approved }, signal);
    if (res.ok) return;
    if (res.status !== 404 || Date.now() >= deadline) {
      throw new Error(`POST /api/chat/approve 失败: ${res.status} ${await res.text()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const pending = ctx.session.id ? pendingApprovals.get(ctx.session.id) : undefined;
  if (pending) {
    pendingApprovals.delete(ctx.session.id!);
    const approved = input.text.trim().toLowerCase() === "approve";
    if (!approved) pending.stream.markRejected(pending.toolUseId);
    await postApprove(pending.toolUseId, approved, ctx.signal);
    return drainStream(pending.cursor, ctx, pending.stream);
  }

  const res = await appFetch(
    "/api/chat",
    { message: input.text, sessionId: ctx.session.isNew ? undefined : ctx.session.id },
    ctx.signal,
  );
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return drainStream(sseJsonFrames<ClaudeFrame>(res.body), ctx, fromClaudeSdkMessages());
}

export default defineAgent({
  name: "claude-sdk",
  capabilities: {
    // 验证过:isNew 时不带 sessionId 开新会话、system/init 帧回传的 session_id 写回
    // ctx.session.id、非 isNew 时带 id 经 SDK 的 resume 续接同一条历史(SDK 落盘在 ~/.claude)。
    conversation: true,
    // 验证过:get_weather / calculate 每次调用都有配对的 tool_use → action.called、
    // tool_result 或 permission_denied → action.result,无遗漏(映射见 fromClaudeSdkMessages)。
    toolObservability: true,
  },
  send,
});
