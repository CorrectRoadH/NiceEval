import type { CodeSource, KnownTranscriptEvent, ObjectRecord, Span, TranscriptEvent } from "../types.ts";

export function asSources(value: unknown): CodeSource[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(isCodeSource) ? value : null;
}

export function isCodeSource(value: unknown): value is CodeSource {
  return isObjectRecord(value) && typeof value.path === "string" && typeof value.content === "string";
}

export function asEvents(value: unknown): TranscriptEvent[] | null {
  if (!Array.isArray(value)) return null;
  // 事件词汇会演进(skill.loaded 就是先例):未识别或缺字段的条目不整体判空、
  // 也不静默丢弃——包成 view.raw 原样展示,让新词汇在界面上可被发现、后续补一等呈现。
  // 全有全无判空会让源码视图的 send 行连回复入口都消失;只有非对象条目没有可展示的结构才丢。
  const out: TranscriptEvent[] = [];
  for (const item of value) {
    if (isKnownTranscriptEvent(item)) out.push(item);
    else if (isObjectRecord(item)) out.push({ type: "view.raw", raw: item });
  }
  return out;
}

export function asSpans(value: unknown): Span[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(isSpan) ? value : null;
}

export function isKnownTranscriptEvent(value: unknown): value is KnownTranscriptEvent {
  if (!isObjectRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "message":
      return (value.role === "assistant" || value.role === "user") && typeof value.text === "string";
    case "action.called":
      return typeof value.callId === "string" && typeof value.name === "string";
    case "action.result":
      return typeof value.callId === "string";
    case "subagent.called":
      return typeof value.callId === "string" && typeof value.name === "string";
    case "subagent.completed":
      return typeof value.callId === "string";
    case "skill.loaded":
      return typeof value.skill === "string";
    case "input.requested":
      return isObjectRecord(value.request);
    case "thinking":
      return typeof value.text === "string";
    case "compaction":
      return true;
    case "error":
      return typeof value.message === "string";
    default:
      return false;
  }
}

export function isSpan(value: unknown): value is Span {
  return (
    isObjectRecord(value) &&
    typeof value.traceId === "string" &&
    typeof value.spanId === "string" &&
    typeof value.name === "string" &&
    typeof value.startMs === "number" &&
    typeof value.endMs === "number"
  );
}

export function isObjectRecord(value: unknown): value is ObjectRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
