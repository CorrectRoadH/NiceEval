import type { ViewUsage } from "../types.ts";

// 通过率/耗时/成本的展示口径与 server 共用一份实现,见 src/view/shared/format.ts。
export { formatCost, formatDuration, formatPercent } from "../../shared/format.ts";

export function prettyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function previewText(value: string): string {
  return String(value).split("\n").find((line) => line.trim()) || "";
}

export function truncate(value: unknown, n: number): string {
  const str = String(value);
  return str.length > n ? str.slice(0, n) + " ... [+" + (str.length - n) + " chars]" : str;
}

export function formatConfigValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function totalTokens(usage?: ViewUsage): number {
  return (usage?.inputTokens || 0) + (usage?.outputTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0);
}

/** 断言 / judge 分数本就是 0–1,直接展示原值(去掉末尾零),不转百分比。pass-rate 之类的「比率」仍用 formatPercent。 */
export function formatScore(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return String(Number(value.toFixed(2)));
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
  if (value >= 1000) return (value / 1000).toFixed(1) + "k";
  return String(Math.round(value));
}

/** 日期按 locale 格式化;不传 locale 时跟随浏览器设置。server 不再预格式化日期,都走这里。 */
export function formatDateTime(iso?: string, locale?: string): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(locale ?? [], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatClock(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
