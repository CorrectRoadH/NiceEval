// pi-sdk 的 adapter:黑盒对接一个**已经在跑**的应用(../src/backend/server.ts,pi 的原生
// `AgentEvent` 原样透传成 SSE,外加三种自定义传输帧:session / approval_request /
// server_error,见 server.ts 头注释)。
//
// `AgentEvent` → 标准事件的映射是官方转换器 `fromPiAgentEvents`(`"niceeval/adapter"` 导出)
// 的事;这里只剩传输粘合:端点在哪、三种传输帧怎么处理、审批打哪个端点。
// 无 OTel(pi-agent-core 没有官方集成),事件全部来自转换器。
//
// HITL:calculate 工具经服务端 beforeToolCall 挂审批。approval_request 帧到达时,流并不关闭——
// 服务端把执行卡在一个 Promise 上等 POST /api/chat/approve。所以这里把"读了一半的 SSE 流"
// (连同转换器状态)存进模块级 Map(key = sessionId),下一次 send(即 t.respond)先打
// approve 端点、再继续读同一条流到结束——不重新发 /api/chat。
import { defineAgent, sseJsonFrames, fromPiAgentEvents } from "niceeval/adapter";
import type { AgentContext, PiAgentStream, SseFrameCursor } from "niceeval/adapter";
import type { JsonValue, StreamEvent, Turn, TurnInput } from "niceeval";
import type { AgentEvent } from "@earendil-works/pi-agent-core";

// 被测应用由你自己按它的方式启动(pnpm start / 部署在哪都行),eval 不代管进程、不另开端口。
const BASE_URL = process.env.PI_SDK_URL ?? "http://127.0.0.1:5299";

type TransportFrame =
  | { type: "session"; sessionId: string }
  | { type: "approval_request"; toolCallId: string; toolName: string; args: unknown }
  | { type: "server_error"; message: string };

type PiFrame = AgentEvent | TransportFrame;

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
      `连不上 ${BASE_URL}${path}。被测应用在跑吗?先起它:cd examples/zh/tier1/pi-sdk && pnpm start(或设 PI_SDK_URL 指向已部署实例)。`,
    );
  }
}

// sessionId -> 还开着的流(+ 转换器状态,续读接着用同一个)。session 帧总是每轮第一个到,
// 写回 ctx.session.id 之后这个 key 才稳定。
interface PendingApproval {
  readonly cursor: SseFrameCursor<PiFrame>;
  readonly stream: PiAgentStream;
  readonly toolCallId: string;
}
const pendingApprovals = new Map<string, PendingApproval>();

async function drainStream(cursor: SseFrameCursor<PiFrame>, ctx: AgentContext, stream: PiAgentStream): Promise<Turn> {
  const events: StreamEvent[] = [];
  let failed = false;

  for (;;) {
    const frame = await cursor.next();
    if (frame === null) break;

    switch (frame.type) {
      case "session": {
        if (ctx.session.isNew) ctx.session.id = frame.sessionId;
        break;
      }
      case "approval_request": {
        if (!ctx.session.id) throw new Error("approval_request 帧到达时 ctx.session.id 还没写回");
        pendingApprovals.set(ctx.session.id, { cursor, stream, toolCallId: frame.toolCallId });
        events.push({
          type: "input.requested",
          request: {
            id: frame.toolCallId,
            action: frame.toolName,
            input: frame.args as JsonValue,
            options: [{ id: "approve" }, { id: "deny" }],
          },
        });
        return { status: "waiting", events, usage: stream.usage };
      }
      case "server_error": {
        failed = true;
        events.push({ type: "error", message: frame.message });
        break;
      }
      default: {
        events.push(...stream.add(frame));
        break;
      }
    }
  }

  return { status: failed ? "failed" : "completed", events, usage: stream.usage };
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const pending = ctx.session.id ? pendingApprovals.get(ctx.session.id) : undefined;
  if (pending) {
    pendingApprovals.delete(ctx.session.id!);
    const approved = input.text.trim().toLowerCase() === "approve";
    if (!approved) pending.stream.markRejected(pending.toolCallId);
    const approveRes = await appFetch("/api/chat/approve", { toolUseId: pending.toolCallId, approved }, ctx.signal);
    if (!approveRes.ok) {
      throw new Error(`POST /api/chat/approve 失败: ${approveRes.status} ${await approveRes.text()}`);
    }
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
  return drainStream(sseJsonFrames<PiFrame>(res.body), ctx, fromPiAgentEvents());
}

export default defineAgent({
  name: "pi-sdk",
  capabilities: {
    // 验证过:isNew 时不带 sessionId 开新会话、server.ts 回传的 sessionId 写回 ctx.session.id、
    // 非 isNew 时带 id 续接同一条服务端内存历史(见 evals/session-isolation.eval.ts)。
    conversation: true,
    // 验证过:get_weather / calculate 每次调用都有配对的 tool_execution_start → action.called、
    // tool_execution_end → action.result,无遗漏(映射见 fromPiAgentEvents)。
    toolObservability: true,
  },
  send,
});
