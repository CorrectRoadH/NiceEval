// 发布消毒与发布预算(见 docs/feature/results/library.md「复制与瘦身:copySnapshots」)。
// 结果数据分两个等级:.niceeval/ 是本地事实根(未消毒);任何要离开本机的拷贝是发布拷贝,
// 只能经 copySnapshots 这一条管线产出,消毒在这里做且没有隐式默认(redact 必填)。
//
// redact 逐值消毒,范围由 schema 的自由文本标注决定:redactor 只对自由文本字段调用——
// 格式、判定、身份、路径、哈希这类结构字段永不经过它,发布根不会因 redact 变得不可读或
// 引用断裂。自由文本清单在下面的 FREE_TEXT 标注单点维护(与 AttemptList.redact 同一口径)。

import type { EvalResult, StreamEvent, TraceSpan } from "../types.ts";

/** 发布前整文件预检的单文件上限(50 MiB,为 GitHub 100 MB 硬限保留余量);不是可调旋钮。 */
export const PUBLISH_FILE_MAX_BYTES = 50 * 1024 * 1024;

export type Redactor = (text: string) => string;

/**
 * 结构字段键名(取值是格式、判定、身份、路径、哈希——redactor 永不触碰):
 * 事件的 type/callId/status/role/tool/skill/requestId/optionId、span 的 ids/kind、
 * 断言的 name/severity/outcome、错误的 code/phase、locator/artifactBase/fingerprint、
 * 源码路径与 sha256、provider 名、时间戳等。新增字符串字段先判断体裁再决定进不进这张表。
 */
const STRUCTURAL_KEYS = new Set([
  "type",
  "callId",
  "status",
  "role",
  "tool",
  "requestId",
  "optionId",
  "id",
  "traceId",
  "spanId",
  "parentSpanId",
  "kind",
  "format",
  "verdict",
  "severity",
  "outcome",
  "artifactBase",
  "locator",
  "fingerprint",
  "sha256",
  "path",
  "file",
  "provider",
  "sandboxId",
  "code",
  "phase",
  "level",
  "agent",
  "model",
  "experimentId",
  "startedAt",
  "completedAt",
  "schemaVersion",
  "evalFilterFingerprint",
  "reasoningEffort",
  "skill",
  "window",
  "net",
  "loc",
  "dedupeKey",
]);

/** 深度遍历 JSON 值:字符串按「键名是否结构字段」决定过不过 redactor;结构键下整棵子树跳过。 */
export function redactJsonValue(value: unknown, redact: Redactor, key?: string): unknown {
  if (typeof value === "string") {
    if (key !== undefined && STRUCTURAL_KEYS.has(key)) return value;
    return redact(value);
  }
  if (Array.isArray(value)) return value.map((v) => redactJsonValue(v, redact, key));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (STRUCTURAL_KEYS.has(k) && typeof v === "string") {
        out[k] = v;
        continue;
      }
      out[k] = redactJsonValue(v, redact, k);
    }
    return out;
  }
  return value;
}

/** events.json 的发布消毒:消息与工具入出参是自由文本,type/callId/status 等结构字段不动。 */
export function redactEvents(events: StreamEvent[], redact: Redactor): StreamEvent[] {
  return redactJsonValue(events, redact) as StreamEvent[];
}

/** trace.json 的发布消毒:属性值与可携带动态内容的 span name 过 redactor,ids/kind 不动。 */
export function redactSpans(spans: TraceSpan[], redact: Redactor): TraceSpan[] {
  return spans.map((span) => ({
    ...span,
    name: redact(span.name),
    ...(span.attributes !== undefined
      ? { attributes: redactJsonValue(span.attributes, redact) as TraceSpan["attributes"] }
      : {}),
  }));
}

/** result.json 的发布消毒:断言 detail/evidence/expected/received、error/diagnostic 的
 *  message/cause/stack、skipReason、description 是自由文本;判定与身份字段不动。 */
export function redactResultRecord(record: Record<string, unknown>, redact: Redactor): Record<string, unknown> {
  const r = record as Partial<EvalResult> & Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };
  if (typeof r.description === "string") out.description = redact(r.description);
  if (typeof r.skipReason === "string") out.skipReason = redact(r.skipReason);
  if (Array.isArray(r.assertions)) {
    out.assertions = r.assertions.map((a) => ({
      ...a,
      ...(a.detail !== undefined ? { detail: redact(a.detail) } : {}),
      ...(a.outcome !== "unavailable" && a.evidence !== undefined ? { evidence: redact(a.evidence) } : {}),
      ...(a.outcome !== "unavailable" && a.expected !== undefined ? { expected: redact(a.expected) } : {}),
      ...(a.outcome !== "unavailable" && a.received !== undefined ? { received: redact(a.received) } : {}),
    }));
  }
  if (r.error !== undefined) {
    out.error = {
      ...r.error,
      message: redact(r.error.message),
      ...(r.error.stack !== undefined ? { stack: redact(r.error.stack) } : {}),
      ...(r.error.cause !== undefined ? { cause: { ...r.error.cause, message: redact(r.error.cause.message) } } : {}),
    };
  }
  if (Array.isArray(r.diagnostics)) {
    out.diagnostics = r.diagnostics.map((d) => ({
      ...d,
      message: redact(d.message),
      ...(d.data !== undefined ? { data: redactJsonValue(d.data, redact) as typeof d.data } : {}),
    }));
  }
  if (r.experiment !== undefined) {
    out.experiment = redactExperimentInfo(r.experiment as unknown as Record<string, unknown>, redact);
  }
  return out;
}

/** ExperimentRunInfo 的发布消毒:description、flags 与 sandbox params 的字符串值。 */
export function redactExperimentInfo(info: Record<string, unknown>, redact: Redactor): Record<string, unknown> {
  const out: Record<string, unknown> = { ...info };
  if (typeof info.description === "string") out.description = redact(info.description);
  if (info.flags !== undefined) out.flags = redactJsonValue(info.flags, redact);
  const sandbox = info.sandbox as { provider: string; params?: Record<string, unknown> } | undefined;
  if (sandbox?.params !== undefined) {
    out.sandbox = { ...sandbox, params: redactJsonValue(sandbox.params, redact) };
  }
  return out;
}
