// otelEvents():把「事件来源 = 本轮收到的 OTel spans」声明在 adapter 上。
//
// 它不是运行时注入 —— 构造出来只是一个来源声明(adapter 文件加载时 core 读到);
// 动态部分(receiver / 归属 / 派生)在 runner 与 SessionManager 里。
// 方言是一等公民:官方方言从 `otel.*` 导出,私有埋点实现 OtelDialect 契约传进
// dialects 数组即可,core 不认任何方言名字(见 docs/adapters/otel-mixin.md)。

import type { OtelDialect } from "../o11y/otlp/dialects.ts";
import {
  aiSdk,
  codex,
  genAi,
  langsmith,
  openInference,
  openLLMetry,
  OFFICIAL_DIALECTS,
} from "../o11y/otlp/dialects.ts";

export interface OtelEventsOptions {
  /**
   * 方言表:省略 = 全部官方方言逐 span 自动识别(识别信号互不相交,混合流各认各的)。
   * 显式钉方言的价值在报错精准(0 命中直接说"期望 X 格式")与私有方言扩展。
   */
  dialects?: readonly OtelDialect[];
  /** 埋点里有消息文本时派生 message 事件(默认 true;设 false 只要工具/用量)。 */
  messages?: boolean;
}

/** 事件来源声明(defineAgent 的 events 字段认这个形状)。 */
export interface OtelEventsSource {
  readonly kind: "otel-events";
  readonly dialects: readonly OtelDialect[];
  readonly messages: boolean;
  /** 是否显式钉了方言(报错措辞用:钉了报"期望 X 格式",没钉报"未识别")。 */
  readonly explicit: boolean;
}

/**
 * 声明「本 agent 的事件流从本轮收到的 OTel spans 派生」。send 只管收发,
 * 工具断言与 trace 瀑布图都从 span 来;多轮 / HITL 仍是 send 的活(span 无此语义)。
 */
export function otelEvents(options: OtelEventsOptions = {}): OtelEventsSource {
  return {
    kind: "otel-events",
    dialects: options.dialects ?? OFFICIAL_DIALECTS,
    messages: options.messages ?? true,
    explicit: options.dialects !== undefined,
  };
}

/** 官方方言命名空间:otelEvents({ dialects: [otel.genAi, myDialect] })。 */
export const otel = {
  /** GenAI semconv(@ai-sdk/otel、OpenClaw、手工按标准埋点)。 */
  genAi,
  /** codex CLI 原生 OTLP(config.toml [otel] 块):工具名 / call_id / usage;span 上没有 I/O 与消息文本。 */
  codex,
  /** AI SDK legacy `experimental_telemetry`(ai.* spans)。 */
  aiSdk,
  /** OpenInference(Arize Phoenix 生态)。 */
  openInference,
  /** OpenLLMetry / traceloop。 */
  openLLMetry,
  /** LangSmith OTel 导出(LANGSMITH_OTEL_ENABLED 路线)。 */
  langsmith,
} as const;

export type { OtelDialect, DialectDerivation } from "../o11y/otlp/dialects.ts";
