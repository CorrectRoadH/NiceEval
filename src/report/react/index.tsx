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

// Attempt 详情组件族的纯 web 面(data 形态;AttemptAssessment / AttemptDetail 是组合组件,
// 不产生新渲染面,只住 niceeval/report)
export { AttemptSummary } from "./AttemptSummary.tsx";
export { AttemptError } from "./AttemptError.tsx";
export { AttemptAssertions } from "./AttemptAssertions.tsx";
export { AttemptSource } from "./AttemptSource.tsx";
export { AttemptFixPrompt } from "./AttemptFixPrompt.tsx";
export { AttemptTimeline } from "./AttemptTimeline.tsx";
export { AttemptConversation } from "./AttemptConversation.tsx";
export { AttemptDiagnostics } from "./AttemptDiagnostics.tsx";
export { AttemptUsage } from "./AttemptUsage.tsx";
export { AttemptTrace } from "./AttemptTrace.tsx";
export { AttemptDiff } from "./AttemptDiff.tsx";

// 数据契约类型(家在 ../types.ts,「算」与「画」两侧共用同一份)
export type {
  AttemptAssertionsData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptConversationRound,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptDiffFileEntry,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptListItem,
  AttemptLocator,
  AttemptSourceData,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  AttemptUsageData,
  CopyFixPromptData,
  DeltaData,
  EvalListItem,
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
export type { AttemptEvidence, AttemptEvidenceCapabilities } from "../../results/attempt-evidence.ts";

// locale(官方组件 chrome 文案;LocalizedText 的按 locale 解析也用它)
export { DEFAULT_REPORT_LOCALE, resolveLocalizedText, resolveMetricLabel } from "../locale.ts";
export type { LocalizedText, ReportLocale } from "../locale.ts";

// 稳定配色(自定义组件想与官方组件同键同色时用;seriesClassForKey 配 CSS 的 --nre-series)
export { NRE_PALETTE, colorClassForKey, colorHexForKey, colorIndexForKey, seriesClassForKey } from "./colors.ts";
