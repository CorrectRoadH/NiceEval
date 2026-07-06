// o11y 域类型:标准事件流(StreamEvent)、折叠事实(DerivedFacts)、
// OTLP trace(TraceSpan / SpanKind)与用量 / 摘要。

import type { JsonValue, SourceLoc } from "../shared/types.ts";

/** 一次运行的 token 用量(沙箱型从 transcript 抠,remote 由 send 返回)。 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  requests?: number;
  /** 网关实测成本(若 agent 带回)——优先于价格表估算。 */
  costUSD?: number;
}

/** 跨 agent 归一化后的规范工具名。 */
export type ToolName =
  | "file_read"
  | "file_write"
  | "file_edit"
  | "shell"
  | "web_fetch"
  | "web_search"
  | "glob"
  | "grep"
  | "list_dir"
  | "agent_task"
  | "unknown";

export interface InputRequest {
  readonly id?: string;
  readonly prompt?: string;
  readonly display?: string;
  readonly action?: string;
  readonly input?: JsonValue;
  readonly options?: readonly { id: string; label?: string }[];
}

/**
 * 标准事件流的词汇(对标 docs/agents-and-adapters.md)。adapter 唯一的硬活就是把
 * 各 agent 五花八门的原始 transcript 映射成 StreamEvent[];映射完,整套断言免费。
 */
export type StreamEvent =
  | { type: "message"; role: "assistant" | "user"; text: string; loc?: SourceLoc }
  | { type: "action.called"; callId: string; name: string; input: JsonValue; tool?: ToolName }
  | {
      type: "action.result";
      callId: string;
      output?: JsonValue;
      status: "completed" | "failed" | "rejected";
    }
  | { type: "subagent.called"; callId: string; name: string; remoteUrl?: string }
  | { type: "subagent.completed"; callId: string; output?: JsonValue; status: "completed" | "failed" }
  | { type: "input.requested"; request: InputRequest }
  | { type: "thinking"; text: string }
  | { type: "compaction"; reason?: string }
  | { type: "error"; message: string };

/** core 从事件流折叠出的结构化事实(deriveRunFacts)。 */
export interface ToolCall {
  callId: string;
  name: ToolName;
  originalName?: string;
  input: JsonValue;
  output?: JsonValue;
  status: "completed" | "failed" | "rejected";
}

export interface SubagentCall {
  callId: string;
  name: string;
  remoteUrl?: string;
  output?: JsonValue;
  status: "completed" | "failed";
}

export interface DerivedFacts {
  readonly toolCalls: readonly ToolCall[];
  readonly subagentCalls: readonly SubagentCall[];
  readonly inputRequests: readonly InputRequest[];
  readonly parked: boolean;
  readonly messageCount: number;
  readonly compactions: number;
}

/**
 * span 的【语义角色】,从 OTel GenAI 语义约定的 gen_ai.operation.name 归一而来
 * (见 o11y/otlp/canonical.ts)。view 据此着色 / 分组 / 跨 agent 对比,**只认这个,
 * 不读原生 span 名**。未识别的 span 落 "other",view 折叠。
 */
export type SpanKind = "turn" | "model" | "tool" | "agent" | "other";

/**
 * 一条分布式追踪的 span(从 agent 经 OpenTelemetry 导出的 OTLP traces 归一而来)。
 * 与 StreamEvent 不同:它带【时间】(起止 epoch 毫秒)与【父子】(parentSpanId),
 * 所以 view 能画成瀑布图。事件流回答「做了什么」,trace 回答「各花了多久、谁套谁」。
 *
 * 两层归一:线格式层(OTLP/JSON|protobuf → 本结构,见 otlp/parse.ts,通用);
 * 语义层(原生 span 名/属性 → canonical GenAI semconv,见 otlp/mappers/<agent>.ts,每 agent 一个薄 mapper)。
 */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** span 起点 / 终点(epoch 毫秒)。 */
  startMs: number;
  endMs: number;
  status?: "ok" | "error" | "unset";
  /**
   * 归一后的语义角色(每-agent mapper 据 canonical GenAI semconv 定;view/select 只认它)。
   * 未经 mapper 或未识别时为 undefined / "other"。
   */
  kind?: SpanKind;
  /** OTLP span 属性(gen_ai.* / tool 名 / token 等),按 key 摊平。raw 属性始终保留供下钻。 */
  attributes?: Record<string, JsonValue>;
}

/** 给人 / 给 EVAL.ts 看的 o11y 摘要(注入沙箱 __niceeval__/results.json)。 */
export interface O11ySummary {
  totalTurns: number;
  /** 只有跑之前调用过的 canonical 工具名才有 key,不是全量出现;省略的 ToolName 视为 0。 */
  toolCalls: Partial<Record<ToolName, number>>;
  totalToolCalls: number;
  filesRead: string[];
  filesModified: string[];
  shellCommands: { command: string; exitCode?: number; success?: boolean }[];
  webFetches: { url: string; status?: number; success?: boolean }[];
  errors: string[];
  thinkingBlocks: number;
  compactions: number;
  durationMs: number;
  usage: Usage;
  estimatedCostUSD?: number;
}
