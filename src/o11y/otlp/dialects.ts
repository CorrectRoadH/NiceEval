// OTel 方言表:span → StreamEvent 派生(otelEvents 的核心,纯函数、可独立单测)。
//
// 「方言」= 某个埋点生态把 GenAI 语义写进 span 属性的方式。每个方言是一个独立模块对象
// (OtelDialect):识别信号 + 派生规则。官方方言之外,用户可实现同一契约传进
// otelEvents({ dialects: [...] }) —— core 不认任何方言名字,只调接口。
//
// 识别是【逐 span】的:一条流里混着 AI SDK spans 和手工 gen_ai spans,各认各的。
// 与 mappers/(span → canonical SpanKind,画瀑布图用)互补:这里产的是喂断言的事件流。

import type { JsonValue, StreamEvent, TraceSpan, Usage } from "../../types.ts";

/**
 * 一个 OTel 方言:matches 判定一条 span 是否属于本方言,derive 把它翻成标准事件 / 用量。
 * derive 只看单条 span(工具 span 自带入参出参,模型 span 自带文本用量),不需要跨 span 状态;
 * 时序由调用方按 span.startMs 排序保证。
 */
export interface OtelDialect {
  readonly name: string;
  matches(span: TraceSpan): boolean;
  derive(span: TraceSpan): DialectDerivation | undefined;
}

export interface DialectDerivation {
  events?: StreamEvent[];
  /** 仅模型类 span 给;由 deriveEventsFromSpans 聚合成 turn 用量。 */
  usage?: Pick<Usage, "inputTokens" | "outputTokens">;
}

export interface SpanDerivation {
  events: StreamEvent[];
  usage?: Usage;
  /** 识别摘要:方言名 → 命中条数(日志用)。 */
  recognized: Record<string, number>;
  /** 一条都没识别出的 span 名(warning 列出来方便排查端点/埋点)。 */
  unrecognized: string[];
}

// ───────────────────────── 属性读取助手 ─────────────────────────

function str(a: Record<string, JsonValue> | undefined, key: string): string | undefined {
  const v = a?.[key];
  return typeof v === "string" ? v : undefined;
}

function num(a: Record<string, JsonValue> | undefined, key: string): number | undefined {
  const v = a?.[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** 属性值常是 JSON 字符串(入参/出参/消息数组);解析失败按原字符串用,不丢数据。 */
function maybeJson(v: JsonValue | undefined): JsonValue | undefined {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s.startsWith("{") && !s.startsWith("[") && !s.startsWith('"')) return v;
  try {
    return JSON.parse(s) as JsonValue;
  } catch {
    return v;
  }
}

function toolStatus(span: TraceSpan): "completed" | "failed" {
  return span.status === "error" ? "failed" : "completed";
}

function toolPair(
  callId: string,
  name: string,
  input: JsonValue | undefined,
  output: JsonValue | undefined,
  span: TraceSpan,
): StreamEvent[] {
  const events: StreamEvent[] = [{ type: "action.called", callId, name, input: input ?? null }];
  events.push({ type: "action.result", callId, output, status: toolStatus(span) });
  return events;
}

/** 从各生态的消息数组形状里抠 assistant 文本(role=assistant 的 content / text / parts)。 */
function assistantTextFromMessages(v: JsonValue | undefined): string | undefined {
  if (!Array.isArray(v)) return undefined;
  const texts: string[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const m = item as Record<string, JsonValue>;
    const role = typeof m.role === "string" ? m.role : undefined;
    if (role !== undefined && role !== "assistant" && role !== "ai") continue;
    const content = m.content ?? m.text ?? m.parts;
    if (typeof content === "string" && content.trim()) texts.push(content);
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === "string" && part.trim()) texts.push(part);
        else if (typeof part === "object" && part !== null && !Array.isArray(part)) {
          const p = part as Record<string, JsonValue>;
          const t = p.text ?? p.content;
          if (typeof t === "string" && t.trim()) texts.push(t);
        }
      }
    }
  }
  const joined = texts.join("").trim();
  return joined ? joined : undefined;
}

function message(text: string | undefined): StreamEvent[] {
  return text && text.trim() ? [{ type: "message", role: "assistant", text }] : [];
}

// ───────────────────────── 官方方言 ─────────────────────────

/** GenAI semconv(gen_ai.operation.name):@ai-sdk/otel、OpenClaw、手工按标准埋的点。 */
export const genAi: OtelDialect = {
  name: "genAi",
  matches: (span) => typeof span.attributes?.["gen_ai.operation.name"] === "string",
  derive(span) {
    const a = span.attributes;
    const op = str(a, "gen_ai.operation.name");
    if (op === "execute_tool") {
      const name = str(a, "gen_ai.tool.name") ?? span.name.replace(/^execute_tool\s+/, "");
      const callId = str(a, "gen_ai.tool.call.id") ?? span.spanId;
      return {
        events: toolPair(
          callId,
          name,
          maybeJson(a?.["gen_ai.tool.call.arguments"]),
          maybeJson(a?.["gen_ai.tool.call.result"]),
          span,
        ),
      };
    }
    if (op === "chat" || op === "text_completion") {
      const input = num(a, "gen_ai.usage.input_tokens") ?? num(a, "gen_ai.usage.prompt_tokens");
      const output = num(a, "gen_ai.usage.output_tokens") ?? num(a, "gen_ai.usage.completion_tokens");
      return {
        events: message(assistantTextFromMessages(maybeJson(a?.["gen_ai.output.messages"]))),
        usage:
          input !== undefined || output !== undefined
            ? { inputTokens: input ?? 0, outputTokens: output ?? 0 }
            : undefined,
      };
    }
    // invoke_agent / create_agent / embeddings:识别但不派生事件(骨架,瀑布图侧消费)。
    return { events: [] };
  },
};

/** AI SDK legacy `experimental_telemetry`(ai.* spans);新版 @ai-sdk/otel 走 genAi。 */
export const aiSdk: OtelDialect = {
  name: "aiSdk",
  matches: (span) =>
    span.name.startsWith("ai.") || (str(span.attributes, "operation.name")?.startsWith("ai.") ?? false),
  derive(span) {
    const a = span.attributes;
    if (span.name === "ai.toolCall") {
      const name = str(a, "ai.toolCall.name") ?? "tool";
      const callId = str(a, "ai.toolCall.id") ?? span.spanId;
      return {
        events: toolPair(callId, name, maybeJson(a?.["ai.toolCall.args"]), maybeJson(a?.["ai.toolCall.result"]), span),
      };
    }
    // usage / 文本只从最外层 pipeline span 取(ai.generateText 等);内层 doGenerate/doStream
    // 也带一份同样的 ai.usage —— 两处都取会双计。
    if (/^ai\.(generateText|streamText|generateObject|streamObject)$/.test(span.name)) {
      const input = num(a, "ai.usage.promptTokens") ?? num(a, "gen_ai.usage.input_tokens");
      const output = num(a, "ai.usage.completionTokens") ?? num(a, "gen_ai.usage.output_tokens");
      return {
        events: message(str(a, "ai.response.text")),
        usage:
          input !== undefined || output !== undefined
            ? { inputTokens: input ?? 0, outputTokens: output ?? 0 }
            : undefined,
      };
    }
    return { events: [] };
  },
};

/** OpenInference(Arize Phoenix 等):openinference.span.kind = TOOL / LLM / CHAIN。 */
export const openInference: OtelDialect = {
  name: "openInference",
  matches: (span) => typeof span.attributes?.["openinference.span.kind"] === "string",
  derive(span) {
    const a = span.attributes;
    const kind = str(a, "openinference.span.kind")?.toUpperCase();
    if (kind === "TOOL") {
      const name = str(a, "tool.name") ?? span.name;
      const callId = str(a, "tool_call.id") ?? span.spanId;
      return { events: toolPair(callId, name, maybeJson(a?.["input.value"]), maybeJson(a?.["output.value"]), span) };
    }
    if (kind === "LLM") {
      // 消息按索引摊平:llm.output_messages.{i}.message.role / .message.content
      const texts: string[] = [];
      for (let i = 0; a && `llm.output_messages.${i}.message.role` in a; i++) {
        const role = str(a, `llm.output_messages.${i}.message.role`);
        const content = str(a, `llm.output_messages.${i}.message.content`);
        if (role === "assistant" && content?.trim()) texts.push(content);
      }
      const input = num(a, "llm.token_count.prompt");
      const output = num(a, "llm.token_count.completion");
      return {
        events: message(texts.join("") || undefined),
        usage:
          input !== undefined || output !== undefined
            ? { inputTokens: input ?? 0, outputTokens: output ?? 0 }
            : undefined,
      };
    }
    return { events: [] };
  },
};

/** OpenLLMetry / traceloop:traceloop.span.kind + gen_ai.prompt/completion.{i}.* 索引式属性。 */
export const openLLMetry: OtelDialect = {
  name: "openLLMetry",
  matches: (span) => {
    const a = span.attributes;
    if (typeof a?.["traceloop.span.kind"] === "string") return true;
    return Object.keys(a ?? {}).some((k) => k.startsWith("gen_ai.prompt.") || k.startsWith("gen_ai.completion."));
  },
  derive(span) {
    const a = span.attributes;
    const kind = str(a, "traceloop.span.kind");
    if (kind === "tool") {
      const name = str(a, "traceloop.entity.name") ?? span.name;
      return {
        events: toolPair(
          span.spanId,
          name,
          maybeJson(a?.["traceloop.entity.input"]),
          maybeJson(a?.["traceloop.entity.output"]),
          span,
        ),
      };
    }
    // llm span:gen_ai.completion.{i}.content(role=assistant)。请求级 tool_calls 列表不在这里
    // 派生 action.called —— 工具的实际执行有自己的 tool/task span,从那边派生才有结果配对。
    const texts: string[] = [];
    for (let i = 0; a && (`gen_ai.completion.${i}.content` in a || `gen_ai.completion.${i}.role` in a); i++) {
      const role = str(a, `gen_ai.completion.${i}.role`);
      const content = str(a, `gen_ai.completion.${i}.content`);
      if ((role === undefined || role === "assistant") && content?.trim()) texts.push(content);
    }
    const input = num(a, "gen_ai.usage.prompt_tokens") ?? num(a, "gen_ai.usage.input_tokens");
    const output = num(a, "gen_ai.usage.completion_tokens") ?? num(a, "gen_ai.usage.output_tokens");
    return {
      events: message(texts.join("") || undefined),
      usage:
        input !== undefined || output !== undefined
          ? { inputTokens: input ?? 0, outputTokens: output ?? 0 }
          : undefined,
    };
  },
};

/**
 * codex CLI 原生 OTLP(`~/.codex/config.toml` 的 [otel] 块,Rust tracing 全量导出):
 * span 靠 `target` / `code.module.name` 以 `codex` 开头识别。
 *
 * 属性形状(2026-07 对 codex 0.142 实测,examples/zh/tier1/codex-sdk 抓的真实 span):
 *   · 工具执行:真正跑的那个 span 带 `tool_name` + `call_id`(+ `aborted`);周边还有一圈
 *     handle_tool_call / dispatch_… 处理骨架,同样标着 gen_ai.operation.name=execute_tool
 *     但没有 call_id —— 只认前者,骨架认领后不派生。
 *   · usage:`session_task.turn` span 的 `codex.turn.token_usage.{input,output}_tokens`。
 *   · 消息文本 / 工具入参出参:span 上没有,派生不了 —— adapter 可自己按 call_id 补 I/O
 *     (mergeDerivedEvents 按 callId 去重,adapter 的映射优先)。
 *
 * 必须排在 genAi 之前:codex 的 span 同时带 gen_ai.operation.name(chat / execute_tool),
 * 但没有 GenAI 语义的 I/O 与 usage 属性 —— 让 genAi 认领的话,每个 execute_tool 骨架 span
 * 都会被派生成一对假工具事件(一次真实调用能冒出六对)。
 */
export const codex: OtelDialect = {
  name: "codex",
  matches(span) {
    const a = span.attributes;
    if (str(a, "target")?.startsWith("codex")) return true;
    if (str(a, "code.module.name")?.startsWith("codex")) return true;
    return Object.keys(a ?? {}).some((k) => k.startsWith("codex."));
  },
  derive(span) {
    const a = span.attributes;
    const toolName = str(a, "tool_name");
    const callId = str(a, "call_id");
    if (toolName && callId) {
      const failed = span.status === "error" || a?.aborted === true;
      return {
        events: [
          { type: "action.called", callId, name: toolName, input: null },
          { type: "action.result", callId, status: failed ? "failed" : "completed" },
        ],
      };
    }
    const input = num(a, "codex.turn.token_usage.input_tokens");
    const output = num(a, "codex.turn.token_usage.output_tokens");
    if (input !== undefined || output !== undefined) {
      return { usage: { inputTokens: input ?? 0, outputTokens: output ?? 0 } };
    }
    // 其余 codex 内部 span(session_loop / rpc 骨架 / 模型流):认领但不派生。
    return { events: [] };
  },
};

/** LangSmith OTel 导出(LANGSMITH_OTEL_ENABLED 路线):langsmith.span.kind = llm / tool / chain。 */
export const langsmith: OtelDialect = {
  name: "langsmith",
  matches: (span) => typeof span.attributes?.["langsmith.span.kind"] === "string",
  derive(span) {
    const a = span.attributes;
    const kind = str(a, "langsmith.span.kind")?.toLowerCase();
    if (kind === "tool") {
      const callId = str(a, "gen_ai.tool.call.id") ?? span.spanId;
      const name = str(a, "gen_ai.tool.name") ?? span.name;
      const input = maybeJson(a?.["gen_ai.prompt"]) ?? maybeJson(a?.["input.value"]);
      const output = maybeJson(a?.["gen_ai.completion"]) ?? maybeJson(a?.["output.value"]);
      return { events: toolPair(callId, name, input, output, span) };
    }
    if (kind === "llm") {
      const completion = maybeJson(a?.["gen_ai.completion"]);
      const text =
        typeof completion === "string"
          ? completion
          : (assistantTextFromMessages(completion) ??
            (typeof (completion as Record<string, JsonValue> | undefined)?.content === "string"
              ? ((completion as Record<string, JsonValue>).content as string)
              : undefined));
      const input = num(a, "gen_ai.usage.input_tokens") ?? num(a, "gen_ai.usage.prompt_tokens");
      const output = num(a, "gen_ai.usage.output_tokens") ?? num(a, "gen_ai.usage.completion_tokens");
      return {
        events: message(text),
        usage:
          input !== undefined || output !== undefined
            ? { inputTokens: input ?? 0, outputTokens: output ?? 0 }
            : undefined,
      };
    }
    return { events: [] };
  },
};

/**
 * 官方方言全表 = 自动识别的默认顺序。识别信号基本互不相交,唯一的刻意重叠是 codex:
 * 它的 span 也带 gen_ai.operation.name,必须排在 genAi 之前认领(见 codex 方言注释)。
 */
export const OFFICIAL_DIALECTS: readonly OtelDialect[] = [codex, genAi, aiSdk, openInference, openLLMetry, langsmith];

// ───────────────────────── 派生入口 ─────────────────────────

/**
 * 把一轮归属到的 spans 派生成标准事件流:按 startMs 排序 → 逐 span 找第一个 matches 的方言
 * → derive。用量跨模型 span 求和。identically 未识别的 span 名收进 unrecognized(0 识别时
 * 由调用方 warning 列出,别静默)。
 */
export function deriveEventsFromSpans(
  spans: readonly TraceSpan[],
  dialects: readonly OtelDialect[] = OFFICIAL_DIALECTS,
): SpanDerivation {
  const sorted = spans.slice().sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const events: StreamEvent[] = [];
  const recognized: Record<string, number> = {};
  const unrecognized: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;

  for (const span of sorted) {
    const dialect = dialects.find((d) => d.matches(span));
    if (!dialect) {
      unrecognized.push(span.name);
      continue;
    }
    const d = dialect.derive(span);
    if (!d) {
      unrecognized.push(span.name);
      continue;
    }
    recognized[dialect.name] = (recognized[dialect.name] ?? 0) + 1;
    if (d.events) events.push(...d.events);
    if (d.usage) {
      sawUsage = true;
      inputTokens += d.usage.inputTokens;
      outputTokens += d.usage.outputTokens;
    }
  }

  return {
    events,
    usage: sawUsage ? { inputTokens, outputTokens } : undefined,
    recognized,
    unrecognized,
  };
}

/**
 * 派生事件与 adapter 自己返回的 events 合并:adapter 的映射优先(它离原生协议最近),
 * 派生只补 adapter 没给的 —— 按 callId 去重工具事件、按 (role, text) 去重消息。
 * 顺序:派生的(span 时序)在前,adapter 的在后(通常是终局消息)。
 */
export function mergeDerivedEvents(
  adapterEvents: readonly StreamEvent[],
  derivedEvents: readonly StreamEvent[],
): StreamEvent[] {
  const seenCallIds = new Set<string>();
  const seenMessages = new Set<string>();
  for (const e of adapterEvents) {
    if (e.type === "action.called" || e.type === "action.result") seenCallIds.add(e.callId);
    if (e.type === "message") seenMessages.add(`${e.role} ${e.text}`);
  }
  const extra = derivedEvents.filter((e) => {
    if (e.type === "action.called" || e.type === "action.result") return !seenCallIds.has(e.callId);
    if (e.type === "message") return !seenMessages.has(`${e.role} ${e.text}`);
    return true;
  });
  return [...extra, ...adapterEvents];
}
