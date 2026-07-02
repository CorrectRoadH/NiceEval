// server 与前端共用的数值格式化;两边展示口径(取整/单位切换阈值)必须一致,所以单独成模块。
// 保持环境无关:不 import node/browser API。日期格式化不在这里 —— 它按前端当前 locale 做,
// 留在 app/lib/format.ts(见 formatDateTime)。

export function formatPercent(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0%";
  return Math.round(value * 100) + "%";
}

export function formatDuration(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms >= 60_000) return (ms / 60_000).toFixed(1) + "m";
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return Math.round(ms) + "ms";
}

export function formatCost(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "$0";
  return "$" + value.toFixed(value < 1 ? 3 : 2);
}
