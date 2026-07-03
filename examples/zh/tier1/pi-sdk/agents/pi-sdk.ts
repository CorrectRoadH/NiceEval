// pi-sdk 的 adapter:黑盒对接 ../src/backend/server.ts 的原生协议 —— pi 的 AgentEvent
// (message_end / tool_execution_start / tool_execution_end / ...)原样透传,外加三种传输层帧
// (session / approval_request / server_error),见 server.ts 头注释。这是本工单唯一从零手写
// 帧映射的应用:无 OTel(见 examples/zh/origin/pi-sdk/README 同级的形态矩阵,pi-sdk 这行是 D 档
// "完全没有 OTel"),事件断言全靠这里的映射。
//
// HITL:calculate 工具经服务端 beforeToolCall 挂审批。approval_request 帧到达时,流并不关闭——
// 服务端把执行卡在一个 Promise 上等 POST /api/chat/approve。所以这里把"读了一半的 SSE 流"存进
// 模块级 Map(key = sessionId),下一次 send(即 t.respond("approve"/"deny"))先查这个 Map、
// 打 approve 端点、再继续读同一条流到结束——不重新发 /api/chat。
import { defineAgent } from "niceeval/adapter";
import type { AgentContext } from "niceeval/adapter";
import type { JsonValue, StreamEvent, Turn, TurnInput, Usage } from "niceeval";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage as PiUsage } from "@earendil-works/pi-ai";
import { ensureServer } from "./server-lifecycle.ts";

type TransportFrame =
  | { type: "session"; sessionId: string }
  | { type: "approval_request"; toolCallId: string; toolName: string; args: unknown }
  | { type: "server_error"; message: string };

type PiFrame = AgentEvent | TransportFrame;

interface SseCursor {
  next(): Promise<PiFrame | null>;
}

function makeSseCursor(body: ReadableStream<Uint8Array>): SseCursor {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function next(): Promise<PiFrame | null> {
    for (;;) {
      const sepIndex = buffer.indexOf("\n\n");
      if (sepIndex !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const line = rawEvent.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        return JSON.parse(line.slice("data: ".length)) as PiFrame;
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
    }
  }

  return { next };
}

// toolCallId 对应的"还开着的流",sessionId 到就绪时用 ctx.session.id 作 key —— server.ts 的
// session 帧总是每轮第一个到,写回 ctx.session.id 之后这个 key 才稳定。
interface PendingApproval {
  readonly cursor: SseCursor;
  readonly toolCallId: string;
}
const pendingApprovals = new Map<string, PendingApproval>();

function extractText(message: AgentMessage): string {
  if (message.role !== "assistant") return "";
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function extractThinking(message: AgentMessage): string {
  if (message.role !== "assistant") return "";
  return message.content
    .filter(
      (part): part is Extract<(typeof message.content)[number], { type: "thinking" }> => part.type === "thinking",
    )
    .map((part) => part.thinking)
    .join("");
}

function addUsage(acc: Usage | undefined, piUsage: PiUsage): Usage {
  return {
    inputTokens: (acc?.inputTokens ?? 0) + piUsage.input,
    outputTokens: (acc?.outputTokens ?? 0) + piUsage.output,
    cacheReadTokens: (acc?.cacheReadTokens ?? 0) + piUsage.cacheRead,
    cacheWriteTokens: (acc?.cacheWriteTokens ?? 0) + piUsage.cacheWrite,
    requests: (acc?.requests ?? 0) + 1,
    costUSD: (acc?.costUSD ?? 0) + piUsage.cost.total,
  };
}

interface DrainOptions {
  /** 这一轮如果是「拒绝」之后的续读,被拒的 toolCallId——它的 tool_execution_end 会带 isError,
   *  要把状态改判成 "rejected" 而不是 "failed"(两者语义不同,见 docs/reference/events)。 */
  readonly rejectedToolCallId?: string;
}

async function drainStream(cursor: SseCursor, ctx: AgentContext, opts: DrainOptions): Promise<Turn> {
  const events: StreamEvent[] = [];
  let usage: Usage | undefined;
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
        pendingApprovals.set(ctx.session.id, { cursor, toolCallId: frame.toolCallId });
        events.push({
          type: "input.requested",
          request: {
            id: frame.toolCallId,
            action: frame.toolName,
            input: frame.args as JsonValue,
            options: [{ id: "approve" }, { id: "deny" }],
          },
        });
        return { status: "waiting", events, usage };
      }
      case "server_error": {
        failed = true;
        events.push({ type: "error", message: frame.message });
        break;
      }
      case "message_end": {
        const text = extractText(frame.message);
        if (text) events.push({ type: "message", role: "assistant", text });
        const thinking = extractThinking(frame.message);
        if (thinking) events.push({ type: "thinking", text: thinking });
        if (frame.message.role === "assistant") usage = addUsage(usage, frame.message.usage);
        break;
      }
      case "tool_execution_start": {
        events.push({
          type: "action.called",
          callId: frame.toolCallId,
          name: frame.toolName,
          input: frame.args as JsonValue,
        });
        break;
      }
      case "tool_execution_end": {
        const status = frame.isError ? (opts.rejectedToolCallId === frame.toolCallId ? "rejected" : "failed") : "completed";
        events.push({ type: "action.result", callId: frame.toolCallId, output: frame.result as JsonValue, status });
        break;
      }
      // agent_start / turn_start / turn_end / message_start / message_update / tool_execution_update /
      // agent_end:没有对应的 StreamEvent,跳过——message_end 已经带了这一步的完整文本,
      // message_update 的增量在这里用不上。
      default:
        break;
    }
  }

  return { status: failed ? "failed" : "completed", events, usage };
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const server = await ensureServer({ model: ctx.model });

  const pending = ctx.session.id ? pendingApprovals.get(ctx.session.id) : undefined;
  if (pending) {
    pendingApprovals.delete(ctx.session.id!);
    const approved = input.text.trim().toLowerCase() === "approve";
    const approveRes = await fetch(`${server.baseUrl}/api/chat/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolUseId: pending.toolCallId, approved }),
      signal: ctx.signal,
    });
    if (!approveRes.ok) {
      throw new Error(`POST /api/chat/approve 失败: ${approveRes.status} ${await approveRes.text()}`);
    }
    return drainStream(pending.cursor, ctx, { rejectedToolCallId: approved ? undefined : pending.toolCallId });
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
  name: "pi-sdk",
  capabilities: {
    // 验证过:isNew 时不带 sessionId 开新会话、server.ts 回传的 sessionId 写回 ctx.session.id、
    // 非 isNew 时带 id 续接同一条服务端内存历史(见 evals/session-isolation.eval.ts)。
    conversation: true,
    // 验证过:get_weather / calculate 每次调用都有配对的 tool_execution_start/end,
    // 无遗漏(见 evals/weather-tool.eval.ts、evals/hitl-approve-deny.eval.ts)。
    toolObservability: true,
  },
  send,
});
