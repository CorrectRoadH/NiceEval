// niceeval 侧的 remote agent adapter —— 唯一"知道 niceeval 存在"的地方。
// ../src/backend/server.ts / ../src/backend/agent.ts / ../src/backend/tools.ts 复制自
// examples/zh/origin/claude-sdk 的一个早期快照(origin 后来已改成 SSE 透传 SDKMessage 的
// 官方 hosting 形态,这份保留旧的 {reply, toolCalls} JSON 接口,本 adapter 依赖它),完全
// 不 import 这里的任何东西;本文件反过来只通过 HTTP 跟它对话,不 import 应用代码。
//
// send() 每次先 ensureServer() 拉起(或复用)子进程里的 server.ts,再打
// POST /api/chat,把 { reply, toolCalls, sessionId } 映射成 niceeval 认识的
// StreamEvent[]。sessionId 写回 ctx.session.id,下一轮 t.send / t.reply 会带着它,
// server.ts 那边再用它去找 Claude Agent SDK 的 resume session —— 会话记忆因此
// 跨轮线程贯穿到底,而不是在 eval 侧另存一份历史。
import { defineAgent } from "niceeval/adapter";
import type { JsonValue, StreamEvent } from "niceeval";
import { BASE_URL, ensureServer } from "./server-lifecycle.ts";

interface ToolCallLog {
  name: string;
  input: JsonValue;
  output: JsonValue;
}

interface ChatResponse {
  reply: string;
  toolCalls?: ToolCallLog[];
  sessionId: string;
}

function toStreamEvents(body: ChatResponse): StreamEvent[] {
  const events: StreamEvent[] = [];
  (body.toolCalls ?? []).forEach((call, i) => {
    const callId = `call_${i}`;
    events.push({ type: "action.called", callId, name: call.name, input: call.input });
    events.push({ type: "action.result", callId, output: call.output, status: "completed" });
  });
  events.push({ type: "message", role: "assistant", text: body.reply });
  return events;
}

export default defineAgent({
  name: "claude-sdk",
  capabilities: { conversation: true, toolObservability: true },

  async send(input, ctx) {
    await ensureServer();

    const r = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: input.text, sessionId: ctx.session.id }),
      signal: ctx.signal,
    });

    if (!r.ok) {
      // server.ts 的路由表(见 route())只在方法/路径不匹配或抛异常时才回非 2xx,
      // 属于「eval 侧的假设错了」而非「agent 执行失败」——as-is 报成 failed 即可,
      // 不需要在这里区分更多子状态。
      const detail = await r.text().catch(() => "");
      return {
        events: [{ type: "error", message: `claude-sdk 服务返回 ${r.status}: ${detail}` }],
        status: "failed",
      };
    }

    const body = (await r.json()) as ChatResponse;
    ctx.session.id = body.sessionId;

    return {
      events: toStreamEvents(body),
      data: body,
      status: "completed",
    };
  },
});
