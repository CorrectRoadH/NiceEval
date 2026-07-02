// 手搓 OTLP/JSON 导出(T3 tracing):adapter 声明 capabilities.tracing 后,niceeval 为
// 本次运行起一个本机 OTLP 接收器,把端点经 ctx.telemetry.endpoint 交给我们;这里把每轮的
// turn / model span 发过去,`niceeval view` 里直接出瀑布图。
//
// 刻意不引 OpenTelemetry SDK:例子零额外依赖、好读;span 属性直接按 niceeval 认的
// canonical(OTel GenAI semconv)发 —— gen_ai.operation.name 决定 SpanKind
// (chat→model、execute_tool→tool),turn.id 让回合 span 归到 "turn"。
import { randomBytes } from "node:crypto";

type AttrValue = string | number | boolean;
export type SpanAttrs = Record<string, AttrValue>;

interface SpanRecord {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: SpanAttrs;
  error: boolean;
}

export interface OtlpSpan {
  end(attrs?: SpanAttrs, opts?: { error?: boolean }): void;
}

export interface OtlpTrace {
  span(name: string, opts?: { parent?: OtlpSpan; attrs?: SpanAttrs }): OtlpSpan;
  flush(): Promise<void>;
}

const NOOP_SPAN: OtlpSpan = { end() {} };

/** 没端点(没开 tracing)就 no-op,adapter 不必写分支。 */
export function createOtlpTrace(endpoint: string | undefined): OtlpTrace {
  if (!endpoint) return { span: () => NOOP_SPAN, flush: async () => {} };

  const traceId = randomBytes(16).toString("hex");
  const records: SpanRecord[] = [];
  const idOf = new WeakMap<OtlpSpan, string>();

  function span(name: string, opts?: { parent?: OtlpSpan; attrs?: SpanAttrs }): OtlpSpan {
    const rec: SpanRecord = {
      spanId: randomBytes(8).toString("hex"),
      parentSpanId: opts?.parent ? idOf.get(opts.parent) : undefined,
      name,
      startMs: Date.now(),
      endMs: 0,
      attributes: { ...(opts?.attrs ?? {}) },
      error: false,
    };
    records.push(rec);
    const handle: OtlpSpan = {
      end(attrs, o) {
        if (rec.endMs) return;
        rec.endMs = Date.now();
        if (attrs) Object.assign(rec.attributes, attrs);
        if (o?.error) rec.error = true;
      },
    };
    idOf.set(handle, rec.spanId);
    return handle;
  }

  async function flush(): Promise<void> {
    const closed = records.filter((r) => r.endMs > 0);
    if (closed.length === 0) return;
    try {
      await fetch(endpoint!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toOtlpJson(traceId, closed)),
      });
    } catch (error) {
      // 导出失败不该影响被测一轮:第二路可观测掉了就掉了。
      process.stderr.write(`[otlp] export failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  return { span, flush };
}

function toOtlpJson(traceId: string, spans: SpanRecord[]): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: [kv("service.name", "ai-sdk-v7-assistant")] },
        scopeSpans: [
          {
            scope: { name: "ai-sdk-v7-example" },
            spans: spans.map((s) => ({
              traceId,
              spanId: s.spanId,
              ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
              name: s.name,
              startTimeUnixNano: `${s.startMs}000000`,
              endTimeUnixNano: `${s.endMs}000000`,
              attributes: Object.entries(s.attributes).map(([k, v]) => kv(k, v)),
              status: { code: s.error ? 2 : 1 },
            })),
          },
        ],
      },
    ],
  };
}

function kv(key: string, value: AttrValue): { key: string; value: Record<string, unknown> } {
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (typeof value === "number") {
    return { key, value: Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value } };
  }
  return { key, value: { stringValue: value } };
}
