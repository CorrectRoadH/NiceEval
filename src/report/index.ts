// niceeval/report —— 报告积木:指标 × 计算函数 × 双面组件 × defineReport。
// 契约见 docs/reports.md;公开叙事的准绳是 docs-site/zh/guides/custom-reports.mdx
// 与 report-components.mdx。
//
// import 边界即运行时边界:计算函数(挂在组件上的 .data)会经句柄触碰文件系统
// (懒加载 artifact),只能进服务端 / 脚本;组件的渲染面纯同步零 IO。text 宿主遍历渲染
// 不需要 react-dom(renderReportToText);web 宿主的 renderReportToStaticHtml 在
// ./web.ts,只有那一侧 import react-dom。写报告文件的项目要装 react(.tsx 编译产物
// import react/jsx-runtime)。

// 指标与 flag
export { defineMetric, passRate, examScore, durationMs, tokens, costUSD, turns } from "./metrics.ts";
export { flag } from "./flag.ts";

// 报告基座与双面组件基座
export { defineReport, isReportDefinition, renderReportToText } from "./report.ts";
export type { ReportContext, ReportDefinition } from "./report.ts";
export { defineComponent } from "./tree.ts";
export type {
  ComponentFaces,
  ReportComponent,
  ReportElement,
  ReportNode,
  TextContext,
  TextRenderOptions,
  WebContext,
} from "./tree.ts";

// 排版原语(五个内置双面组件)
export { Row, Col, Section, Text, Style } from "./primitives.tsx";
export type { LayoutProps, SectionProps, StyleProps } from "./primitives.tsx";

// 官方水位整块(零 props 的锚点)与内置默认报告(报告槽的出厂填充,一份普通 ReportDefinition)
export { DefaultReport } from "./official-report.tsx";
export { defaultReport } from "./default-report.tsx";

// locale:官方组件 chrome 文案的语言(en / zh-CN);指标 label 可按 locale 给字典
export { DEFAULT_REPORT_LOCALE, resolveMetricLabel } from "./locale.ts";
export type { LocalizedLabel, ReportLocale } from "./locale.ts";

// 官方双面组件(各自带 data 计算函数;MetricBars.data = MetricMatrix.data)
export {
  CaseList,
  DeltaTable,
  GroupSummary,
  MetricBars,
  MetricLine,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  RunOverview,
  Scoreboard,
} from "./components.tsx";
export type {
  CaseListProps,
  DeltaTableProps,
  GroupSummaryProps,
  MetricLineProps,
  MetricMatrixProps,
  MetricScatterProps,
  MetricTableProps,
  RunOverviewProps,
  ScoreboardProps,
} from "./components.tsx";

// 计算函数的选项类型(函数本体挂在组件上,不做顶层导出)
export type {
  CaseListDataOptions,
  DeltaDataOptions,
  DeltaPair,
  LineDataOptions,
  MatrixDataOptions,
  ScatterDataOptions,
  ScoreboardDataOptions,
  TableDataOptions,
} from "./compute.ts";

// 数据契约(组件的 data props)
export type {
  Aggregator,
  AttemptRef,
  CaseListData,
  DeltaData,
  Dimension,
  DimensionInput,
  GroupSummaryData,
  LineAxis,
  LineData,
  MatrixData,
  Metric,
  MetricAggregate,
  MetricCell,
  MetricColumn,
  OverviewData,
  FlagRef,
  ScatterData,
  ScoreboardData,
  SelectionWarning,
  TableData,
  TableRowMeta,
} from "./types.ts";

// 数据层输入的类型(家在 niceeval/results,这里 re-export 方便写指标 / 报告)
export type { AttemptHandle, Results, Selection, Snapshot } from "../results/index.ts";

// experiment id 的组键推导:defaultReport 按目录前缀分组用的就是这一份(见 default-report.tsx);
// 在此重新导出,让自定义报告能用同一份口径分组,不必自己重新写这两行逻辑。
export { experimentGroupOf } from "../shared/aggregate.ts";
