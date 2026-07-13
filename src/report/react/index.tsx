// niceeval/report/react —— 零件复用的导出点:把某一块指标表嵌进已有内部面板时从这里
// import。导出的组件与 niceeval/report 是同一批双面组件(web 面即 React 渲染,零 IO、
// 可进 "use client",不 hydrate 也完整),都带自己的 data 计算函数;那是零件的复用,
// 不是另一套报告系统 —— 报告的家在官方宿主(--report)。
//
// 契约:
//   - 组件只认「算好的可序列化数据」:零 hooks、零数据操作;
//   - 样式随包发布:配套 ./styles.css(nre-* 稳定类名),使用者在其后加载覆盖即可;
//   - 跨块配色一致:维度键 → 稳定散列 → 固定调色板下标(colors.ts)。

export {
  AttemptList,
  DeltaTable,
  EvalList,
  ExperimentList,
  GroupSummary,
  MetricBars,
  MetricLine,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  RunOverview,
  Scoreboard,
} from "../components.tsx";
export type {
  AttemptListProps,
  DeltaTableProps,
  EvalListProps,
  ExperimentListProps,
  GroupSummaryProps,
  MetricLineProps,
  MetricMatrixProps,
  MetricScatterProps,
  MetricTableProps,
  RunOverviewProps,
  ScoreboardProps,
} from "../components.tsx";

// 数据契约类型(家在 ../types.ts,「算」与「画」两侧共用同一份)
export type {
  AttemptListItem,
  AttemptLocator,
  DeltaData,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  GroupSummaryData,
  LineAxis,
  LineData,
  MatrixData,
  MetricCell,
  MetricColumn,
  OverviewData,
  ScatterData,
  ScoreboardData,
  SelectionWarning,
  TableData,
  TableRowMeta,
} from "../types.ts";

// locale(官方组件 chrome 文案;指标 label 的按 locale 字典也用它解析)
export { DEFAULT_REPORT_LOCALE, resolveMetricLabel } from "../locale.ts";
export type { LocalizedLabel, ReportLocale } from "../locale.ts";

// 稳定配色(自定义组件想与官方组件同键同色时用;seriesClassForKey 配 CSS 的 --nre-series)
export { NRE_PALETTE, colorClassForKey, colorHexForKey, colorIndexForKey, seriesClassForKey } from "./colors.ts";
