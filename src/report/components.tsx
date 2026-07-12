// 官方双面组件的装配点:web 面(./react/ 的纯 React 组件)+ text 面(./text/faces.ts)
// + 挂在组件上的 data 计算函数。faces 两键必填 —— 配对是结构义务,不是配对表;
// MetricBars.data 就是 MetricMatrix.data(同一份矩阵数据的另一种摆法),别名显式化。
//
// 官方组件在宿主里自动接上证据室:web 面的 attemptHref 缺省取 ctx.attemptHref
// (宿主注入的证据室深链);显式传 prop 可覆盖(嵌进自己应用时自定去处)。

import { defineComponent, isHostWebContextActive } from "./tree.ts";
import type { ReportLocale } from "./locale.ts";
import type { AttemptRef, Selection } from "../results/index.ts";
import type {
  CaseListData,
  DeltaData,
  ExperimentTableData,
  GroupSummaryData,
  LineData,
  MatrixData,
  OverviewData,
  ScatterData,
  ScoreboardData,
  TableData,
} from "./types.ts";
import {
  caseListData,
  deltaData,
  experimentTableData,
  groupSummaryData,
  lineData,
  matrixData,
  overviewData,
  scatterData,
  scoreboardData,
  tableData,
} from "./compute.ts";
import type { ExperimentTableDataOptions, ScatterDataOptions } from "./compute.ts";
import {
  barsText,
  caseListText,
  deltaText,
  experimentTableText,
  groupSummaryText,
  lineText,
  matrixText,
  overviewText,
  scatterText,
  scoreboardText,
  tableText,
} from "./text/faces.ts";
import { RunOverview as RunOverviewWeb } from "./react/RunOverview.tsx";
import { GroupSummary as GroupSummaryWeb } from "./react/GroupSummary.tsx";
import { ExperimentTable as ExperimentTableWeb } from "./react/ExperimentTable.tsx";
import { MetricTable as MetricTableWeb } from "./react/MetricTable.tsx";
import { MetricMatrix as MetricMatrixWeb } from "./react/MetricMatrix.tsx";
import { MetricBars as MetricBarsWeb } from "./react/MetricBars.tsx";
import { Scoreboard as ScoreboardWeb } from "./react/Scoreboard.tsx";
import { MetricScatter as MetricScatterWeb } from "./react/MetricScatter.tsx";
import { MetricLine as MetricLineWeb } from "./react/MetricLine.tsx";
import { DeltaTable as DeltaTableWeb } from "./react/DeltaTable.tsx";
import { CaseList as CaseListWeb } from "./react/CaseList.tsx";

// ───────────────────────── props ─────────────────────────

export interface RunOverviewProps {
  data: OverviewData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface GroupSummaryProps {
  data: GroupSummaryData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

/** ExperimentTable 两臂共享的纯渲染选项(不含数据来源)。 */
interface ExperimentTableRenderProps {
  attemptHref?: (ref: AttemptRef) => string;
  /** web 面在工作台前显示实验过滤输入框；渐进增强 runtime 按整条 experiment 过滤。 */
  filter?: boolean;
  locale?: ReportLocale;
  className?: string;
}

/** resolve 之后 web / text 面看到的形态:数据已备好,零 IO。 */
export interface ExperimentTableResolvedProps extends ExperimentTableRenderProps {
  data: ExperimentTableData;
}

/**
 * 互斥两臂:直接给算好的 `data`,或给 `selection`(+ 可选 `evals` 过滤)让宿主渲染前解析。
 * 同时传 `data` 与 `selection`、或两者都不传,都在 typecheck 阶段失败。计算选项复用
 * `ExperimentTableDataOptions`。
 */
export type ExperimentTableProps =
  | (ExperimentTableResolvedProps & { selection?: never; evals?: never })
  | ({ data?: never } & ExperimentTableDataOptions & ExperimentTableRenderProps & { selection: Selection });

export interface MetricTableProps {
  data: TableData;
  /** 传了,格子可点、下钻去处你定;不传,宿主里走证据室深链,宿主外纯展示。 */
  attemptHref?: (ref: AttemptRef) => string;
  /**
   * web 面在表格前渲染一个过滤输入框(`<input class="nre-filter" data-nre-filter>`),
   * 由渐进增强 runtime(enhance.js)接管:输入过滤行 textContent。无 JS 时输入框
   * 静默无功能,表格内容依旧完整可读。默认 false;text 面不受影响。
   */
  filter?: boolean;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface MetricMatrixProps {
  data: MatrixData;
  attemptHref?: (ref: AttemptRef) => string;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface ScoreboardProps {
  data: ScoreboardData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

/** MetricScatter 两臂共享的纯渲染选项(不含数据来源)。 */
interface MetricScatterRenderProps {
  /** 点一个点 → 该配置的下钻页。 */
  pointHref?: (row: ScatterData["rows"][number]) => string;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

/** resolve 之后 web / text 面看到的形态:数据已备好,零 IO。 */
export interface MetricScatterResolvedProps extends MetricScatterRenderProps {
  data: ScatterData;
}

/**
 * 互斥两臂:要么直接给算好的 `data`(用于用户自己的 React 页面 / 预计算 / 跨边界序列化),
 * 要么给 `selection` + 计算选项让宿主在渲染前解析(见 tree.ts 的 resolveReportTree)。
 * 同时传 `data` 与 `selection`、或两者都不传,都在 typecheck 阶段失败。计算选项复用
 * `ScatterDataOptions`,不手写会漂移的副本。
 */
export type MetricScatterProps =
  | (MetricScatterResolvedProps & {
      selection?: never;
      points?: never;
      series?: never;
      x?: never;
      y?: never;
    })
  | ({ data?: never } & ScatterDataOptions & MetricScatterRenderProps & { selection: Selection });

export interface MetricLineProps {
  data: LineData;
  pointHref?: (row: LineData["rows"][number]) => string;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface DeltaTableProps {
  data: DeltaData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface CaseListProps {
  data: CaseListData;
  attemptHref?: (ref: AttemptRef) => string;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

// ───────────────────────── 装配 ─────────────────────────

const SCATTER_UNRESOLVED_MESSAGE =
  "MetricScatter received unresolved (selection-form) props outside the report host pipeline. " +
  "Render through defineReport + niceeval show/view (or renderReportToText/renderReportToStaticHtml), " +
  "or precompute with `await MetricScatter.data(selection, options)` and pass the result as `data`.";

const EXPERIMENT_TABLE_UNRESOLVED_MESSAGE =
  "ExperimentTable received unresolved (selection-form) props outside the report host pipeline. " +
  "Render through defineReport + niceeval show/view (or renderReportToText/renderReportToStaticHtml), " +
  "or precompute with `await ExperimentTable.data(selection, options)` and pass the result as `data`.";

/** 渲染面(web / text)只吃已解析的数据形态;selection 形态漏解析时直说,而不是画一张空组件。 */
function requireScatterData(props: { data?: ScatterData }): ScatterData {
  if (props.data === undefined) throw new Error(SCATTER_UNRESOLVED_MESSAGE);
  return props.data;
}

function requireExperimentTableData(props: { data?: ExperimentTableData }): ExperimentTableData {
  if (props.data === undefined) throw new Error(EXPERIMENT_TABLE_UNRESOLVED_MESSAGE);
  return props.data;
}

/** 页头 KPI 条:何时跑的、几个配置、几道题、通过率、总成本;Selection 的警告随行显示在条内。 */
export const RunOverview = Object.assign(
  defineComponent<RunOverviewProps>({
    web: (props, ctx) => <RunOverviewWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => overviewText(data, ctx),
  }),
  { data: overviewData },
);
RunOverview.displayName = "RunOverview";

/**
 * 组摘要:一组 experiment(典型用法是同一 `<Section>` 内的全部 experiment)的紧凑统计——
 * 通过率(旧 GroupSelector 卡片口径)、experiment/eval/attempt 数、eval 级折叠计票、
 * 总成本、最后运行时间。
 */
export const GroupSummary = Object.assign(
  defineComponent<GroupSummaryProps>({
    web: (props, ctx) => <GroupSummaryWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => groupSummaryText(data, ctx),
  }),
  { data: groupSummaryData },
);
GroupSummary.displayName = "GroupSummary";

/** Experiment 诊断工作台:主行看整体表现,原生展开查看配置、KPI 与逐 eval/attempt 证据。 */
export const ExperimentTable = Object.assign(
  defineComponent<ExperimentTableProps, ExperimentTableResolvedProps>({
    resolve: async (props) => {
      if ("data" in props && props.data !== undefined) return props;
      const { selection, evals, ...rest } = props;
      return { ...rest, data: await experimentTableData(selection, { evals }) };
    },
    web: (props, ctx) => {
      requireExperimentTableData(props);
      return (
        <ExperimentTableWeb
          {...props}
          locale={props.locale ?? ctx.locale}
          attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)}
        />
      );
    },
    text: (props, ctx) => experimentTableText(requireExperimentTableData(props), ctx),
  }),
  { data: experimentTableData },
);
ExperimentTable.displayName = "ExperimentTable";

/** 榜单:一行一个维度值、一列一个指标,回答「谁整体更好」。 */
export const MetricTable = Object.assign(
  defineComponent<MetricTableProps>({
    web: (props, ctx) => (
      <MetricTableWeb
        {...props}
        locale={props.locale ?? ctx.locale}
        attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)}
      />
    ),
    text: ({ data }, ctx) => tableText(data, ctx),
  }),
  { data: tableData },
);
MetricTable.displayName = "MetricTable";

/** 逐题格子:行 × 列两个维度、格子里一个指标,回答「哪道题谁挂了」。 */
export const MetricMatrix = Object.assign(
  defineComponent<MetricMatrixProps>({
    web: (props, ctx) => (
      <MetricMatrixWeb
        {...props}
        locale={props.locale ?? ctx.locale}
        attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)}
      />
    ),
    text: ({ data }) => matrixText(data),
  }),
  { data: matrixData },
);
MetricMatrix.displayName = "MetricMatrix";

/** 分组条形:同一份矩阵数据的另一种摆法;MetricBars.data 就是 MetricMatrix.data 的别名。 */
export const MetricBars = Object.assign(
  defineComponent<MetricMatrixProps>({
    web: (props, ctx) => (
      <MetricBarsWeb
        {...props}
        locale={props.locale ?? ctx.locale}
        attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)}
      />
    ),
    text: ({ data }) => barsText(data),
  }),
  { data: matrixData },
);
MetricBars.displayName = "MetricBars";

/** 考试成绩单:总分 + 分科小计,固定分母、missing 如实报。 */
export const Scoreboard = Object.assign(
  defineComponent<ScoreboardProps>({
    web: (props, ctx) => <ScoreboardWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => scoreboardText(data, ctx),
  }),
  { data: scoreboardData },
);
Scoreboard.displayName = "Scoreboard";

/** 质量 × 成本 frontier:每个点一个配置、两个指标各占一轴,「好」的角落恒在右上。 */
export const MetricScatter = Object.assign(
  defineComponent<MetricScatterProps, MetricScatterResolvedProps>({
    resolve: async (props) => {
      if ("data" in props && props.data !== undefined) return props;
      const { selection, points, series, x, y, ...rest } = props;
      return { ...rest, data: await scatterData(selection, { points, series, x, y }) };
    },
    web: (props, ctx) => {
      requireScatterData(props);
      return <MetricScatterWeb {...props} locale={props.locale ?? ctx.locale} />;
    },
    text: (props, ctx) => scatterText(requireScatterData(props), ctx),
  }),
  { data: scatterData },
);
MetricScatter.displayName = "MetricScatter";

/** 趋势线:x 是 experiment 声明的 flag(flag()),同系列按 x 排序连线。 */
export const MetricLine = Object.assign(
  defineComponent<MetricLineProps>({
    web: (props, ctx) => <MetricLineWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => lineText(data, ctx),
  }),
  { data: lineData },
);
MetricLine.displayName = "MetricLine";

/** 成对对比:每行一对配置、格子里 A、B、Δ 三个值,涨跌好坏由 better 判定。 */
export const DeltaTable = Object.assign(
  defineComponent<DeltaTableProps>({
    web: (props, ctx) => <DeltaTableWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => deltaText(data, ctx),
  }),
  { data: deltaData },
);
DeltaTable.displayName = "DeltaTable";

/** 失败案例清单:榜单回答「多少」,它回答「为什么」;truncated 如实报剩余。 */
export const CaseList = Object.assign(
  defineComponent<CaseListProps>({
    web: (props, ctx) => (
      <CaseListWeb
        {...props}
        locale={props.locale ?? ctx.locale}
        attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)}
      />
    ),
    text: (props, ctx) => caseListText(props.data, ctx),
  }),
  { data: caseListData },
);
CaseList.displayName = "CaseList";
