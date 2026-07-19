// niceeval/report/react —— 纯 web 渲染面的导出点:把某一块指标表嵌进已有 React 页面时
// 从这里 import。组件只收算好的可序列化 `data`(data 形态),不含任何读盘 / artifact
// 计算代码;计算函数、spec 形态与组合组件只住在 niceeval/report。
//
// 契约:
//   - 组件只认「算好的可序列化数据」:零 hooks、零数据操作;
//   - 样式随包发布:配套 ./styles.css(nre-* 稳定类名),使用者在其后加载覆盖即可;
//   - 渐进增强脚本 ./enhance.js 可选加载,初始静态 HTML 无 JS 完整可读;
//   - 跨块配色一致:维度键 → 稳定散列 → 固定调色板下标(colors.ts)。

export { AttemptList } from "./AttemptList.tsx";
export { EvalList } from "./EvalList.tsx";
export { ExperimentList } from "./ExperimentList.tsx";
export { ScopeSummary } from "./ScopeSummary.tsx";
export { ExperimentComparisonView as ExperimentComparison } from "./ExperimentComparison.tsx";
export { MetricTable } from "./MetricTable.tsx";
export { MetricMatrix } from "./MetricMatrix.tsx";
export { MetricBars } from "./MetricBars.tsx";
export { MetricScatter } from "./MetricScatter.tsx";
export { MetricLine } from "./MetricLine.tsx";
export { DeltaTable } from "./DeltaTable.tsx";
export { Scoreboard } from "./Scoreboard.tsx";

// 站点组件的纯 web 面(data 形态;Hero 是组合组件,只住 niceeval/report)
export { HeroCard } from "./HeroCard.tsx";
export { PoweredBy } from "./PoweredBy.tsx";
export { ScopeWarnings } from "./ScopeWarnings.tsx";
export { CopyFixPrompt } from "./CopyFixPrompt.tsx";
export { TraceWaterfall } from "./TraceWaterfall.tsx";

// 数据契约类型(家在 ../types.ts,「算」与「画」两侧共用同一份)
export type {
  AttemptListItem,
  AttemptLocator,
  CopyFixPromptData,
  DeltaData,
  EvalListItem,
  ExperimentComparisonData,
  ExperimentListEvalRow,
  ExperimentListItem,
  HeroData,
  LineData,
  MatrixData,
  MetricCell,
  MetricColumn,
  ScatterData,
  ScopeSummaryData,
  ScopeWarning,
  ScoreboardData,
  TableData,
  TraceSpanSummary,
  TraceWaterfallRow,
  VerdictTally,
} from "../types.ts";

// locale(官方组件 chrome 文案;LocalizedText 的按 locale 解析也用它)
export { DEFAULT_REPORT_LOCALE, resolveLocalizedText, resolveMetricLabel } from "../locale.ts";
export type { LocalizedText, ReportLocale } from "../locale.ts";

// 稳定配色(自定义组件想与官方组件同键同色时用;seriesClassForKey 配 CSS 的 --nre-series)
export { NRE_PALETTE, colorClassForKey, colorHexForKey, colorIndexForKey, seriesClassForKey } from "./colors.ts";
