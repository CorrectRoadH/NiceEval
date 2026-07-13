// web 面的小工具:展示格式化统一住在计算侧的 ../format.ts(两个渲染面同一份),
// 这里 re-export 并补 class 名拼接。MetricCell 一律自带 display,组件不重算。

export { MISSING_TEXT, formatDurationMs, formatPercent, formatUSD, verdictMark } from "../format.ts";

/** 拼 class 名:过滤空值,末尾接使用者透传的 className。 */
export function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}
