// claude-sdk 的 adapter:黑盒对接 ../src/backend/server.ts —— 原生 `SDKMessage` 流原样透传成
// SSE(server.ts 不做协议翻译),外加一个自定义 { type: "server_error" } 帧(query() 之外的失败,
// 比如 spawn 失败)。无 OTel(CLI 原生遥测只有 metrics+logs,niceeval 不消费 trace spans),
// 事件断言全靠这里的手工映射。
//
// HITL 没有显式的"等审批"帧——`canUseTool` 把流卡在一个 Promise 上,客户端只能从
// "gated 工具的 tool_use 到了、之后没动静"推断。Tier 1 的确定性做法:被门控的工具就
// mcp__demo-tools__calculate 一个(agent.ts 里的 GATED_TOOL_NAME,这里必须写死同一个字符串),
// adapter 见到它的 tool_use 块就直接按审批点处理。
import { defineAgent } from "niceeval/adapter";
import type { AgentContext } from "niceeval/adapter";
import type { JsonValue, StreamEvent, Turn, TurnInput, Usage } from "niceeval";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ensureServer } from "./server-lifecycle.ts";

// 必须和 ../src/backend/agent.ts 里的 GATED_TOOL_NAME 完全一致(MCP 命名空间下的真实工具名)。
const GATED_TOOL_NAME = "mcp__demo-tools__calculate";

type TransportFrame = { type: "server_error"; message: string };
type ClaudeFrame = SDKMessage | TransportFrame;

interface SseCursor {
  next(): Promise<ClaudeFrame | null>;
}

function makeSseCursor(body: ReadableStream<Uint8Array>): SseCursor {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function next(): Promise<ClaudeFrame | null> {
    for (;;) {
      const sepIndex = buffer.indexOf("\n\n");
      if (sepIndex !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const line = rawEvent.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        return JSON.parse(line.slice("data: ".length)) as ClaudeFrame;
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
    }
  }

  return { next };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

interface TextBlock {
  readonly type: "text";
  readonly text: string;
}
interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}
interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content?: unknown;
  readonly is_error?: boolean;
}

function isTextBlock(b: unknown): b is TextBlock {
  return isRecord(b) && b.type === "text" && typeof b.text === "string";
}
function isToolUseBlock(b: unknown): b is ToolUseBlock {
  return isRecord(b) && b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string";
}
function isToolResultBlock(b: unknown): b is ToolResultBlock {
  return isRecord(b) && b.type === "tool_result" && typeof b.tool_use_id === "string";
}

function toolResultText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter(isTextBlock).map((b) => b.text).join("");
  return undefined;
}

// sessionId -> 还开着的流 + 卡住的 gated tool_use id。key 用 ctx.session.id——system/init
// 帧总是每轮第一个到,写回 ctx.session.id 之后这个 key 才稳定。
interface PendingApproval {
  readonly cursor: SseCursor;
  readonly toolUseId: string;
}
const pendingApprovals = new Map<string, PendingApproval>();

interface DrainOptions {
  /** 这一轮如果是「拒绝」之后的续读,被拒的 tool_use id——用来给它去重,避免
   *  system/permission_denied 帧和(如果 SDK 也发的话)tool_result 块各产一条 action.result。 */
  readonly rejectedToolUseId?: string;
}

async function drainStream(cursor: SseCursor, ctx: AgentContext, opts: DrainOptions): Promise<Turn> {
  const events: StreamEvent[] = [];
  const resolvedCallIds = new Set<string>();
  let usage: Usage | undefined;
  let status: "completed" | "failed" = "completed";

  for (;;) {
    const frame = await cursor.next();
    if (frame === null) break;

    if (frame.type === "server_error") {
      status = "failed";
      events.push({ type: "error", message: frame.message });
      continue;
    }

    switch (frame.type) {
      case "system": {
        if (frame.subtype === "init" && ctx.session.isNew && !ctx.session.id) {
          ctx.session.id = frame.session_id;
        } else if (frame.subtype === "permission_denied" && !resolvedCallIds.has(frame.tool_use_id)) {
          resolvedCallIds.add(frame.tool_use_id);
          events.push({ type: "action.result", callId: frame.tool_use_id, status: "rejected" });
        }
        break;
      }
      case "assistant": {
        const content: unknown[] = Array.isArray(frame.message.content) ? frame.message.content : [];
        let gatedToolUseId: string | undefined;
        for (const block of content) {
          if (isTextBlock(block) && block.text) {
            events.push({ type: "message", role: "assistant", text: block.text });
          } else if (isToolUseBlock(block)) {
            events.push({
              type: "action.called",
              callId: block.id,
              name: block.name,
              input: block.input as JsonValue,
            });
            if (block.name === GATED_TOOL_NAME) gatedToolUseId = block.id;
          }
        }
        if (gatedToolUseId) {
          if (!ctx.session.id) throw new Error("gated tool_use 到达时 ctx.session.id 还没写回");
          pendingApprovals.set(ctx.session.id, { cursor, toolUseId: gatedToolUseId });
          events.push({
            type: "input.requested",
            request: {
              id: gatedToolUseId,
              action: GATED_TOOL_NAME,
              options: [{ id: "approve" }, { id: "deny" }],
            },
          });
          return { status: "waiting", events, usage };
        }
        break;
      }
      case "user": {
        const content: unknown[] = Array.isArray(frame.message.content) ? frame.message.content : [];
        for (const block of content) {
          if (isToolResultBlock(block) && !resolvedCallIds.has(block.tool_use_id)) {
            resolvedCallIds.add(block.tool_use_id);
            const rejected = opts.rejectedToolUseId === block.tool_use_id;
            events.push({
              type: "action.result",
              callId: block.tool_use_id,
              output: toolResultText(block.content) as JsonValue,
              status: rejected ? "rejected" : block.is_error ? "failed" : "completed",
            });
          }
        }
        break;
      }
      case "result": {
        status = frame.is_error ? "failed" : "completed";
        usage = {
          inputTokens: frame.usage.input_tokens,
          outputTokens: frame.usage.output_tokens,
          cacheReadTokens: frame.usage.cache_read_input_tokens ?? undefined,
          cacheWriteTokens: frame.usage.cache_creation_input_tokens ?? undefined,
          requests: frame.num_turns,
          costUSD: frame.total_cost_usd,
        };
        break;
      }
      // stream_event(逐 token 渲染用)、其它系统/生命周期消息(status / commands_changed /
      // session_state_changed / worker_shutting_down / ...):没有对应的 StreamEvent,跳过。
      default:
        break;
    }
  }

  return { status, events, usage };
}

/**
 * approve 端点在极少数情况下会在 canUseTool 真正把 resolver 存进服务端 pendingApprovals 之前
 * 就被我们打到——tool_use 块本身是"模型已经决定调用"的证据,但 SDK 内部要再过几十毫秒才跑到
 * canUseTool 回调去注册 resolver。404 大概率是这个注册竞态,不是真的没有这次审批,短退避重试
 * 几次;其它状态码直接抛。
 */
async function postApprove(baseUrl: string, toolUseId: string, approved: boolean, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const res = await fetch(`${baseUrl}/api/chat/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolUseId, approved }),
      signal,
    });
    if (res.ok) return;
    if (res.status !== 404 || Date.now() >= deadline) {
      throw new Error(`POST /api/chat/approve 失败: ${res.status} ${await res.text()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const server = await ensureServer({ model: ctx.model });

  const pending = ctx.session.id ? pendingApprovals.get(ctx.session.id) : undefined;
  if (pending) {
    pendingApprovals.delete(ctx.session.id!);
    const approved = input.text.trim().toLowerCase() === "approve";
    await postApprove(server.baseUrl, pending.toolUseId, approved, ctx.signal);
    return drainStream(pending.cursor, ctx, { rejectedToolUseId: approved ? undefined : pending.toolUseId });
  }

  const res = await fetch(`${server.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: input.text,
      sessionId: ctx.session.isNew ? undefined : ctx.session.id,
    }),
    signal: ctx.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return drainStream(makeSseCursor(res.body), ctx, {});
}

export default defineAgent({
  name: "claude-sdk",
  capabilities: {
    // 验证过:isNew 时不带 sessionId 开新会话、system/init 帧回传的 session_id 写回
    // ctx.session.id、非 isNew 时带 id 经 SDK 的 resume 续接同一条历史(SDK 落盘在 ~/.claude)。
    conversation: true,
    // 验证过:get_weather / calculate 每次调用都有配对的 tool_use → action.called、
    // tool_result 或 permission_denied → action.result,无遗漏。
    toolObservability: true,
  },
  send,
});
