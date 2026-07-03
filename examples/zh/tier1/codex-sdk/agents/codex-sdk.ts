// codex-sdk 的 adapter:黑盒对接 ../src/backend/server.ts —— 原生 `ThreadEvent` 流原样透传成
// SSE(server.ts 不做协议翻译),外加一个和 `ThreadErrorEvent` 同形状的 `{type:"error"}` 帧
// (query() 之外的失败,比如 spawn 失败)。没有 HITL(Codex SDK 不支持),永不返回 "waiting"。
//
// tracing:codex CLI 自家的 span 命名(无标准 GenAI 属性、无工具 I/O),官方方言认不出,
// 事件断言仍走这里的 SSE 帧映射,不用 `events: otelEvents()`。瀑布图本该用内置的
// codex spanMapper(`src/o11y/otlp/mappers/codex.ts` 的 `mapCodexSpans`)归一,但那个模块没有
// 从 "niceeval/adapter" 的公开导出面暴露出来(package.json 的 exports 只开了 "."/"./adapter"/
// "./sandbox"/"./expect"/"./reporters"/"./loaders" 几个子路径,深路径导入会被 Node 的
// exports map 挡掉)——这是黑盒例子只能拿到已发布公开 API 的真实约束,不是本次疏漏,已记进
// memory/codex-mapcodexspans-not-publicly-exported.md。这里省略 spanMapper,走 core 的通用
// heuristic 兜底(SpanMapper 类型注释本来就允许省略)。
import { defineAgent } from "niceeval/adapter";
import type { AgentContext } from "niceeval/adapter";
import type { JsonValue, StreamEvent, ToolName, Turn, TurnInput, Usage } from "niceeval";
import type { ThreadEvent } from "@openai/codex-sdk";
import { ensureServer } from "./server-lifecycle.ts";

type TransportFrame = { type: "error"; message: string };
type CodexFrame = ThreadEvent | TransportFrame;

interface SseCursor {
  next(): Promise<CodexFrame | null>;
}

function makeSseCursor(body: ReadableStream<Uint8Array>): SseCursor {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function next(): Promise<CodexFrame | null> {
    for (;;) {
      const sepIndex = buffer.indexOf("\n\n");
      if (sepIndex !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const line = rawEvent.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        return JSON.parse(line.slice("data: ".length)) as CodexFrame;
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
    }
  }

  return { next };
}

// item.type → 跨 agent 归一化的 ToolName(见 docs-site 事件流参考);mcp_tool_call 没有统一的
// 语义分类,留 "unknown"。
const TOOL_NAME_BY_ITEM_TYPE: Partial<Record<string, ToolName>> = {
  command_execution: "shell",
  file_change: "file_edit",
  web_search: "web_search",
};

// item 的哪些字段算"入参"/"结果",按 item.type 摘出来——item 本身在 started/completed 两次
// 事件里字段不完全一致(比如 command_execution 的 exit_code 只在 completed 时有)。
function itemInput(item: Record<string, unknown>): JsonValue {
  switch (item.type) {
    case "command_execution":
      return { command: item.command } as JsonValue;
    case "file_change":
      return { changes: item.changes } as JsonValue;
    case "mcp_tool_call":
      return { server: item.server, tool: item.tool, arguments: item.arguments } as JsonValue;
    case "web_search":
      return { query: item.query } as JsonValue;
    default:
      return null;
  }
}

function itemOutput(item: Record<string, unknown>): JsonValue | undefined {
  switch (item.type) {
    case "command_execution":
      return { aggregated_output: item.aggregated_output, exit_code: item.exit_code } as JsonValue;
    case "file_change":
      return { changes: item.changes } as JsonValue;
    case "mcp_tool_call":
      return (item.result ?? item.error) as JsonValue | undefined;
    default:
      return undefined;
  }
}

function itemStatus(item: Record<string, unknown>): "completed" | "failed" {
  return item.status === "failed" ? "failed" : "completed";
}

// 只有这几种 item 算"工具调用"(有 started/completed 两段生命周期);agent_message /
// reasoning / error / todo_list 走各自的映射,不产 action.called/result。
const TOOL_ITEM_TYPES = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search"]);

async function drainStream(cursor: SseCursor, ctx: AgentContext): Promise<Turn> {
  const events: StreamEvent[] = [];
  let usage: Usage | undefined;
  let status: "completed" | "failed" = "completed";

  for (;;) {
    const frame = await cursor.next();
    if (frame === null) break;

    switch (frame.type) {
      case "thread.started": {
        if (ctx.session.isNew) ctx.session.id = frame.thread_id;
        break;
      }
      case "item.started": {
        const item = frame.item as unknown as Record<string, unknown>;
        if (TOOL_ITEM_TYPES.has(item.type as string)) {
          events.push({
            type: "action.called",
            callId: item.id as string,
            name: item.type as string,
            input: itemInput(item),
            tool: TOOL_NAME_BY_ITEM_TYPE[item.type as string] ?? "unknown",
          });
        }
        break;
      }
      case "item.completed": {
        const item = frame.item as unknown as Record<string, unknown>;
        if (item.type === "agent_message") {
          const text = item.text as string;
          if (text) events.push({ type: "message", role: "assistant", text });
        } else if (item.type === "reasoning") {
          const text = item.text as string;
          if (text) events.push({ type: "thinking", text });
        } else if (item.type === "error") {
          events.push({ type: "error", message: item.message as string });
        } else if (TOOL_ITEM_TYPES.has(item.type as string)) {
          events.push({
            type: "action.result",
            callId: item.id as string,
            output: itemOutput(item),
            status: itemStatus(item),
          });
        }
        break;
      }
      case "turn.completed": {
        usage = {
          inputTokens: frame.usage.input_tokens,
          outputTokens: frame.usage.output_tokens,
          cacheReadTokens: frame.usage.cached_input_tokens,
        };
        break;
      }
      case "turn.failed": {
        status = "failed";
        events.push({ type: "error", message: frame.error.message });
        break;
      }
      case "error": {
        status = "failed";
        events.push({ type: "error", message: frame.message });
        break;
      }
      // item.updated(中间态,比如 command_execution 还在跑时的 aggregated_output 增量)、
      // turn.started:没有对应的 StreamEvent,跳过。
      default:
        break;
    }
  }

  return { status, events, usage };
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const server = await ensureServer({ model: ctx.model, telemetryEnv: ctx.telemetry?.env });

  const res = await fetch(`${server.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: input.text,
      threadId: ctx.session.isNew ? undefined : ctx.session.id,
    }),
    signal: ctx.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return drainStream(makeSseCursor(res.body), ctx);
}

export default defineAgent({
  name: "codex-sdk",
  capabilities: {
    // 验证过:isNew 时不带 threadId 开新会话、thread.started 帧回传的 thread_id 写回
    // ctx.session.id、非 isNew 时带 id 经 codex.resumeThread 续接同一条历史
    // (SDK 落盘在 ~/.codex/sessions)。
    conversation: true,
    // 验证过:command_execution / file_change / mcp_tool_call 每次调用都有配对的
    // item.started → action.called、item.completed → action.result,无遗漏。
    toolObservability: true,
    // 长驻服务,tracing.scope 必须是 "run"(见 tracing 块)。
    tracing: true,
  },
  tracing: {
    scope: "run",
    // codex 配置里自己拼 /v1/traces(见 origin src/backend/agent.ts 的 otelConfig),
    // 这里传 base、去掉尾巴。
    env: (endpoint) => ({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint.replace(/\/v1\/traces$/, "") }),
  },
  send,
});
