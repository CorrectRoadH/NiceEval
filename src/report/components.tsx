// 官方双面组件的装配点:web 面(./react/ 的纯 React 组件)+ text 面(./text/faces.ts)
// + resolve 解析面(spec 形态由管线代调配套 *Data 函数)。faces 两键必填 —— 配对是结构
// 义务;MetricBars 与 MetricMatrix 消费同一份矩阵数据(同一个 metricMatrixData)。
//
// props 双形态以 `data` 判别(docs/feature/reports/library/metric-views.md):
//   spec 形态 = 计算选项平铺 + 可选 `input`(默认宿主注入的 Scope),管线在 resolve 阶段
//   代调同名 *Data,与手工计算严格等价;data 形态接收算好的可序列化数据,跳过取数。
//   同一组件同时给出 `data` 与 spec 字段按完整用户反馈报错,不静默取一边。
// 组件消费 `data` 时校验结构,不符合当前形状按完整用户反馈报错并提示可能的版本漂移。
//
// 官方组件在宿主里自动接上证据室:web 面的 attemptHref 缺省取 ctx.attemptHref
// (宿主注入的证据室深链);显式传 prop 可覆盖(嵌进自己应用时自定去处)。

import type { ReactNode } from "react";
import {
  defineComponent,
  isHostWebContextActive,
  memoFetchOf,
  type ReportComponent,
  type ResolveContext,
  type TextContext,
  type WebContext,
} from "./tree.ts";
import type { ReportLocale } from "./locale.ts";
import type { AttemptLocator } from "../results/locator.ts";
import type {
  AttemptListItem,
  DeltaData,
  EntityListDataOptions,
  EvalListItem,
  ExperimentComparisonData,
  ExperimentListItem,
  LineData,
  MatrixData,
  ReportInput,
  ScatterData,
  ScopeSummaryData,
  ScoreboardData,
  TableData,
} from "./types.ts";
import {
  attemptListData,
  deltaTableData,
  evalListData,
  experimentComparisonData,
  experimentListData,
  metricLineData,
  metricMatrixData,
  metricScatterData,
  metricTableData,
  scopeSummaryData,
  scoreboardData,
  type DeltaTableOptions,
  type MetricLineOptions,
  type MetricMatrixOptions,
  type MetricScatterOptions,
  type MetricTableOptions,
  type ScoreboardOptions,
} from "./compute.ts";
import { collectItems, locatorOf, resolveInput } from "./aggregate.ts";
import {
  attemptListText,
  deltaText,
  evalListText,
  experimentComparisonText,
  experimentListText,
  barsText,
  lineText,
  matrixText,
  scatterText,
  scoreboardText,
  scopeSummaryText,
  tableText,
} from "./text/faces.ts";
import { ScopeSummary as ScopeSummaryWeb } from "./react/ScopeSummary.tsx";
import { ExperimentComparisonView } from "./react/ExperimentComparison.tsx";
import { ExperimentList as ExperimentListWeb } from "./react/ExperimentList.tsx";
import { EvalList as EvalListWeb } from "./react/EvalList.tsx";
import { AttemptList as AttemptListWeb } from "./react/AttemptList.tsx";
import { MetricTable as MetricTableWeb } from "./react/MetricTable.tsx";
import { MetricMatrix as MetricMatrixWeb } from "./react/MetricMatrix.tsx";
import { MetricBars as MetricBarsWeb } from "./react/MetricBars.tsx";
import { Scoreboard as ScoreboardWeb } from "./react/Scoreboard.tsx";
import { MetricScatter as MetricScatterWeb } from "./react/MetricScatter.tsx";
import { MetricLine as MetricLineWeb } from "./react/MetricLine.tsx";
import { DeltaTable as DeltaTableWeb } from "./react/DeltaTable.tsx";

// ───────────────────────── DataProps 组合规则 ─────────────────────────

type Never<T> = { [K in keyof T]?: never };

/**
 * 官方数据组件的统一 props 组合(docs/feature/reports/library/metric-views.md):
 * data 形态(接收配套 *Data 的产物)或 spec 形态(Options 平铺 + 可选 input)。
 */
export type DataProps<Data, Options, Presentation> =
  | ({ data: Data; input?: never } & Never<Options> & Presentation)
  | ({ data?: never; input?: ReportInput } & Options & Presentation);

// ───────────────────────── data 结构校验(版本漂移防线)─────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCell(value: unknown): boolean {
  return (
    isObject(value) &&
    "value" in value &&
    "display" in value &&
    typeof value.samples === "number" &&
    typeof value.total === "number" &&
    Array.isArray(value.refs)
  );
}

function isTally(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.passed === "number" &&
    typeof value.failed === "number" &&
    typeof value.errored === "number" &&
    typeof value.skipped === "number"
  );
}

type Validator = (data: unknown) => string | null;

function dataShapeError(component: string, dataFnName: string, shape: string, problem: string): Error {
  return new Error(
    `<${component}> received data that does not match the current ${shape} shape: ${problem}. ` +
      `It may have been computed by a different niceeval version (component data carries no schemaVersion; the support window is same-version write and read). ` +
      `Recompute it with ${dataFnName}() from this niceeval version, then re-render.`,
  );
}

const validateTableData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string") return 'missing "rowDimension" (string)';
  if (!Array.isArray(data.columns)) return 'missing "columns" (array)';
  if (!Array.isArray(data.rows)) return 'missing "rows" (array)';
  for (const row of data.rows as unknown[]) {
    if (!isObject(row) || typeof row.key !== "string" || !isObject(row.cells)) {
      return 'each row needs { key, cells }';
    }
  }
  return null;
};

const validateMatrixData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string" || typeof data.columnDimension !== "string") {
    return 'missing "rowDimension" / "columnDimension" (string)';
  }
  if (!isObject(data.metric)) return 'missing "metric" (MetricColumn)';
  if (!Array.isArray(data.cells)) return 'missing "cells" (array)';
  return null;
};

const validateScatterData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.pointDimension !== "string") return 'missing "pointDimension" (string)';
  if (!isObject(data.x) || !isObject(data.y)) return 'missing "x" / "y" (MetricColumn)';
  if (!Array.isArray(data.rows)) return 'missing "rows" (array)';
  for (const row of data.rows as unknown[]) {
    if (!isObject(row) || typeof row.key !== "string" || !isCell(row.x) || !isCell(row.y)) {
      return "each row needs { key, x: MetricCell, y: MetricCell }";
    }
  }
  return null;
};

const validateLineData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!isObject(data.x) || typeof (data.x as Record<string, unknown>).key !== "string") return 'missing "x" axis descriptor';
  if (!isObject(data.y)) return 'missing "y" (MetricColumn)';
  if (!Array.isArray(data.rows)) return 'missing "rows" (array)';
  return null;
};

const validateScoreboardData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string") return 'missing "rowDimension" (string)';
  if (!Array.isArray(data.questions)) return 'missing "questions" (array)';
  if (typeof data.fullMarks !== "number") return 'missing "fullMarks" (number)';
  if (typeof data.ignoredEvals !== "number") return 'missing "ignoredEvals" (number)';
  if (!Array.isArray(data.rows)) return 'missing "rows" (array)';
  for (const row of data.rows as unknown[]) {
    if (!isObject(row) || !isObject(row.total) || typeof (row.total as Record<string, unknown>).notRun !== "number") {
      return 'each row needs { key, total: { value, display, notRun, unscorable, refs }, subjects }';
    }
  }
  return null;
};

const validateDeltaData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.byDimension !== "string") return 'missing "byDimension" (string)';
  if (!Array.isArray(data.columns) || !Array.isArray(data.rows)) return 'missing "columns" / "rows" (array)';
  for (const row of data.rows as unknown[]) {
    if (!isObject(row) || row.label === undefined || !isObject(row.a) || !isObject(row.b)) {
      return "each row needs { key, label, a, b, cells }";
    }
  }
  return null;
};

const validateScopeSummaryData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!isObject(data.range)) return 'missing "range" ({ earliestStartedAt, latestStartedAt })';
  if (!isTally(data.evalVerdicts) || !isTally(data.attemptVerdicts)) {
    return 'missing "evalVerdicts" / "attemptVerdicts" tallies';
  }
  if (!isCell(data.endToEndPassRate) || !isCell(data.totalCostUSD)) {
    return 'missing "endToEndPassRate" / "totalCostUSD" (MetricCell)';
  }
  return null;
};

const validateComparisonData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!Array.isArray(data.groups)) return 'missing "groups" (array)';
  for (const group of data.groups as unknown[]) {
    if (!isObject(group) || typeof group.key !== "string" || validateScopeSummaryData(group.summary) !== null) {
      return "each group needs { key, summary, scatter, experiments }";
    }
  }
  return null;
};

const validateExperimentListData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of ExperimentListItem";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.experimentId !== "string" || !isTally(item.evalVerdicts) || !isCell(item.endToEndPassRate)) {
      return "each item needs { experimentId, evalVerdicts, endToEndPassRate, costUSD, durationMs, tokens, evalRows, … }";
    }
  }
  return null;
};

const validateEvalListData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of EvalListItem";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.evalId !== "string" || !isCell(item.examScore) || !Array.isArray(item.attempts)) {
      return "each item needs { experimentId, evalId, verdict, examScore, durationMs, costUSD, attempts }";
    }
  }
  return null;
};

const validateAttemptListData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of AttemptListItem";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.evalId !== "string" || !("failureSummary" in item) || !("costUSD" in item)) {
      return "each item needs { experimentId, evalId, verdict, failureSummary, moreFailures, examScore, durationMs, costUSD, locator }";
    }
  }
  return null;
};

// ───────────────────────── spec / data 双形态的通用装配 ─────────────────────────

interface DataComponentDef<Data, Options, Presentation> {
  name: string;
  dataFnName: string;
  shapeName: string;
  dataFn: (input: ReportInput, options: Options) => Promise<Data>;
  /** spec 形态的计算选项 prop 名(不含 input);未列出的 props 视为呈现选项原样保留。 */
  specKeys: readonly string[];
  validate: Validator;
  web(props: { data: Data } & Presentation, ctx: WebContext): ReactNode;
  text(props: { data: Data } & Presentation, ctx: TextContext): string;
}

function makeDataComponent<Data, Options, Presentation>(
  def: DataComponentDef<Data, Options, Presentation>,
): ReportComponent<DataProps<Data, Options, Presentation>> {
  type Props = Record<string, unknown>;
  type Resolved = { data: Data } & Presentation;

  const assertData = (data: unknown): Data => {
    const problem = def.validate(data);
    if (problem !== null) throw dataShapeError(def.name, def.dataFnName, def.shapeName, problem);
    return data as Data;
  };

  const resolve = async (props: Props, ctx: ResolveContext): Promise<Resolved> => {
    const givenSpec = def.specKeys.filter((key) => props[key] !== undefined);
    if (props.data !== undefined) {
      if (givenSpec.length > 0 || props.input !== undefined) {
        const extras = [...givenSpec, ...(props.input !== undefined ? ["input"] : [])];
        throw new Error(
          `<${def.name}> got both \`data\` and spec field${extras.length > 1 ? "s" : ""} (${extras.join(", ")}) — the two data sources are exclusive and niceeval will not silently pick one. ` +
            `Keep \`data\` (precomputed with ${def.dataFnName}()) and drop the spec fields, or drop \`data\` and let the pipeline compute from the spec.`,
        );
      }
      assertData(props.data);
      return props as unknown as Resolved;
    }
    const options: Record<string, unknown> = {};
    for (const key of givenSpec) options[key] = props[key];
    const input = (props.input as ReportInput | undefined) ?? ctx.input;
    const data = await memoFetchOf(ctx)(def.dataFn, input, options, () =>
      def.dataFn(input, options as Options),
    );
    const rest: Record<string, unknown> = { ...props };
    delete rest.input;
    for (const key of def.specKeys) delete rest[key];
    return { ...rest, data } as unknown as Resolved;
  };

  const component = defineComponent<Props, Resolved>({
    resolve,
    web: (props, ctx) => {
      assertData((props as { data?: unknown }).data);
      return def.web(props, ctx);
    },
    text: (props, ctx) => {
      assertData((props as { data?: unknown }).data);
      return def.text(props, ctx);
    },
  }) as unknown as ReportComponent<DataProps<Data, Options, Presentation>>;
  component.displayName = def.name;
  return component;
}

/** 宿主内缺省接证据室,显式 prop 覆盖;宿主外不传 attemptHref 就是纯展示。 */
function hrefOf(
  props: { attemptHref?: (locator: AttemptLocator) => string },
  ctx: WebContext,
): ((locator: AttemptLocator) => string) | undefined {
  return props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined);
}

// ───────────────────────── 呈现选项类型 ─────────────────────────

interface ChromeProps {
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

// ───────────────────────── 概览组件 ─────────────────────────

export type ScopeSummaryProps = DataProps<
  ScopeSummaryData,
  Record<never, never>,
  ChromeProps & {
    /** 显示哪一级计票;默认 "eval"。data 恒携带两级,votes 只选择呈现。 */
    votes?: "eval" | "attempt";
  }
>;

/** 范围摘要卡:时间窗、数量、两级计票、端到端成功率与总成本。 */
export const ScopeSummary = makeDataComponent<
  ScopeSummaryData,
  Record<never, never>,
  ChromeProps & { votes?: "eval" | "attempt" }
>({
  name: "ScopeSummary",
  dataFnName: "scopeSummaryData",
  shapeName: "ScopeSummaryData",
  dataFn: (input) => scopeSummaryData(input),
  specKeys: [],
  validate: validateScopeSummaryData,
  web: (props, ctx) => <ScopeSummaryWeb {...props} locale={props.locale ?? ctx.locale} />,
  text: (props, ctx) => scopeSummaryText(props.data, props.votes ?? "eval", ctx),
}) as unknown as ReportComponent<ScopeSummaryProps>;

export type ExperimentComparisonProps = DataProps<ExperimentComparisonData, Record<never, never>, ChromeProps>;

/**
 * 内建报告的默认组合件:先把 input 按可比组分区,再为每组分别计算 ScopeSummary、
 * 成本 × 端到端成功率散点和 ExperimentList。web 面持有完整组索引并一次聚焦一组;
 * text 面命中多个组时只显示组索引与可执行的单组查看命令,命中单组时才输出完整散点与列表。
 */
export const ExperimentComparison = makeDataComponent<ExperimentComparisonData, Record<never, never>, ChromeProps>({
  name: "ExperimentComparison",
  dataFnName: "experimentComparisonData",
  shapeName: "ExperimentComparisonData",
  dataFn: (input) => experimentComparisonData(input),
  specKeys: [],
  validate: validateComparisonData,
  web: (props, ctx) => (
    <ExperimentComparisonView
      data={props.data}
      locale={props.locale ?? ctx.locale}
      className={props.className}
      attemptHref={isHostWebContextActive() ? ctx.attemptHref : undefined}
    />
  ),
  text: (props, ctx) => experimentComparisonText(props.data, props.className, ctx),
}) as unknown as ReportComponent<ExperimentComparisonProps>;

// ───────────────────────── 实体列表 ─────────────────────────

interface EntityListChrome extends ChromeProps {
  attemptHref?: (locator: AttemptLocator) => string;
}

export type ExperimentListProps = DataProps<
  readonly ExperimentListItem[],
  EntityListDataOptions,
  EntityListChrome & {
    /** web 面在比较表前显示实验过滤框;text 面忽略。 */
    filter?: boolean;
    /**
     * 可选父路径:两面的行标签去掉与它相同的前缀,只显示 experiment id 末段(默认
     * `ExperimentComparison` 给每组传组键)。完整 id 仍是排序 / 着色 / 过滤 / 折叠的键。
     */
    relativeTo?: string;
  }
>;

/** 实验列表:每项一个 experiment,固定八列比较表 + 展开到 Eval / Attempt。 */
export const ExperimentList = makeDataComponent<
  readonly ExperimentListItem[],
  EntityListDataOptions,
  EntityListChrome & { filter?: boolean; relativeTo?: string }
>({
  name: "ExperimentList",
  dataFnName: "experimentListData",
  shapeName: "ExperimentListItem[]",
  dataFn: (input, options) => experimentListData(input, options),
  specKeys: ["redact"],
  validate: validateExperimentListData,
  web: (props, ctx) => (
    <ExperimentListWeb
      data={props.data}
      filter={props.filter}
      relativeTo={props.relativeTo}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx) ?? ctx.attemptHref}
      className={props.className}
    />
  ),
  text: (props, ctx) => experimentListText(props.data, ctx, props.relativeTo),
}) as unknown as ReportComponent<ExperimentListProps>;

export type EvalListProps = DataProps<readonly EvalListItem[], EntityListDataOptions, EntityListChrome>;

/** Eval 列表:每项一个 experimentId + evalId,展开到这道题的 Attempt。 */
export const EvalList = makeDataComponent<readonly EvalListItem[], EntityListDataOptions, EntityListChrome>({
  name: "EvalList",
  dataFnName: "evalListData",
  shapeName: "EvalListItem[]",
  dataFn: (input, options) => evalListData(input, options),
  specKeys: ["redact"],
  validate: validateEvalListData,
  web: (props, ctx) => (
    <EvalListWeb
      data={props.data}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx) ?? ctx.attemptHref}
      className={props.className}
    />
  ),
  text: (props, ctx) => evalListText(props.data, ctx),
}) as unknown as ReportComponent<EvalListProps>;

export type AttemptListProps = DataProps<
  readonly AttemptListItem[],
  EntityListDataOptions,
  EntityListChrome & {
    /** 过滤 / 截断前的总数;省略时等于 data 长度。 */
    total?: number;
  }
>;

/** Attempt 列表:实体列表的叶子层,每项一次 attempt 的判定、单行摘要与 locator。 */
export const AttemptList = makeDataComponent<
  readonly AttemptListItem[],
  EntityListDataOptions,
  EntityListChrome & { total?: number }
>({
  name: "AttemptList",
  dataFnName: "attemptListData",
  shapeName: "AttemptListItem[]",
  dataFn: (input, options) => attemptListData(input, options),
  specKeys: ["redact"],
  validate: validateAttemptListData,
  web: (props, ctx) => (
    <AttemptListWeb
      data={props.data}
      total={props.total}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx) ?? ctx.attemptHref}
      className={props.className}
    />
  ),
  text: (props, ctx) => attemptListText(props.data, props.total, ctx),
}) as unknown as ReportComponent<AttemptListProps>;

// ───────────────────────── FailureList(官方组合件)─────────────────────────

export interface FailureListProps {
  /** 显示的最大条数;默认 20。 */
  limit?: number;
  /** 默认宿主注入的 Scope。 */
  input?: ReportInput;
  redact?: (text: string) => string;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

/**
 * 「现在有哪些失败要处理」的成品组合件:内部就是 attemptListData → 过滤 → AttemptList
 * data 形态,与手写组合严格等价、没有私有能力(docs/feature/reports/library/entity-lists.md)。
 * verdict ∈ failed / errored,按 attempt 开始时间降序(同刻按 locator 字典序),
 * 截断到 limit(默认 20),total 报告截断前总数。
 */
export const FailureList = defineComponent<FailureListProps>(async (props, ctx) => {
  const input = props.input ?? ctx.scope;
  const all = await attemptListData(input, props.redact !== undefined ? { redact: props.redact } : undefined);
  // attempt 开始时间不在列表条目里(它不是列表展示字段);从同一 input 的读取面按 locator 对回。
  const startedAtByLocator = new Map<string, string>();
  for (const item of collectItems(resolveInput(input).snapshots)) {
    startedAtByLocator.set(locatorOf(item), item.attempt.result.startedAt ?? "");
  }
  const failures = all
    .filter((item) => item.verdict === "failed" || item.verdict === "errored")
    .sort((a, b) => {
      const ta = startedAtByLocator.get(a.locator) ?? "";
      const tb = startedAtByLocator.get(b.locator) ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1; // 最近的失败在前
      return a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0;
    });
  const limit = props.limit ?? 20;
  return (
    <AttemptList
      data={failures.slice(0, limit)}
      total={failures.length}
      attemptHref={props.attemptHref}
      locale={props.locale}
      className={props.className}
    />
  );
});
FailureList.displayName = "FailureList";

// ───────────────────────── 指标组件 ─────────────────────────

export type MetricTableProps = DataProps<
  TableData,
  MetricTableOptions,
  ChromeProps & {
    /** web 面在表格前渲染过滤输入框(enhance.js 接管);无 JS 时表格内容依旧完整。 */
    filter?: boolean;
    attemptHref?: (locator: AttemptLocator) => string;
  }
>;

/** 榜单:一行一个维度值、一列一个指标,回答「谁整体更好」。 */
export const MetricTable = makeDataComponent<
  TableData,
  MetricTableOptions,
  ChromeProps & { filter?: boolean; attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "MetricTable",
  dataFnName: "metricTableData",
  shapeName: "TableData",
  dataFn: metricTableData,
  specKeys: ["rows", "columns", "sort", "evals"],
  validate: validateTableData,
  web: (props, ctx) => (
    <MetricTableWeb
      data={props.data}
      filter={props.filter}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => tableText(props.data, ctx),
}) as unknown as ReportComponent<MetricTableProps>;

export type MetricMatrixProps = DataProps<
  MatrixData,
  MetricMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;
export type MetricBarsProps = MetricMatrixProps;

/** 逐题格子:行 × 列两个维度、格子里一个指标,回答「哪道题谁挂了」。 */
export const MetricMatrix = makeDataComponent<
  MatrixData,
  MetricMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "MetricMatrix",
  dataFnName: "metricMatrixData",
  shapeName: "MatrixData",
  dataFn: metricMatrixData,
  specKeys: ["rows", "columns", "cell", "evals"],
  validate: validateMatrixData,
  web: (props, ctx) => (
    <MetricMatrixWeb data={props.data} locale={props.locale ?? ctx.locale} attemptHref={hrefOf(props, ctx)} className={props.className} />
  ),
  text: (props, ctx) => matrixText(props.data, ctx),
}) as unknown as ReportComponent<MetricMatrixProps>;

/** 分组条形:同一份矩阵数据的另一种摆法;与 MetricMatrix 写同一份 spec 时只计算一次。 */
export const MetricBars = makeDataComponent<
  MatrixData,
  MetricMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "MetricBars",
  dataFnName: "metricMatrixData",
  shapeName: "MatrixData",
  dataFn: metricMatrixData,
  specKeys: ["rows", "columns", "cell", "evals"],
  validate: validateMatrixData,
  web: (props, ctx) => (
    <MetricBarsWeb data={props.data} locale={props.locale ?? ctx.locale} attemptHref={hrefOf(props, ctx)} className={props.className} />
  ),
  text: (props, ctx) => barsText(props.data, ctx),
}) as unknown as ReportComponent<MetricBarsProps>;

export type ScoreboardProps = DataProps<
  ScoreboardData,
  ScoreboardOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;

/** 考试成绩单:总分 + 分科小计,固定分母、notRun / unscorable 分开如实报。 */
export const Scoreboard = makeDataComponent<
  ScoreboardData,
  ScoreboardOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "Scoreboard",
  dataFnName: "scoreboardData",
  shapeName: "ScoreboardData",
  dataFn: scoreboardData,
  specKeys: ["rows", "questions", "subject", "weights", "fullMarks", "score"],
  validate: validateScoreboardData,
  web: (props, ctx) => <ScoreboardWeb data={props.data} locale={props.locale ?? ctx.locale} className={props.className} />,
  text: (props, ctx) => scoreboardText(props.data, ctx),
}) as unknown as ReportComponent<ScoreboardProps>;

export type MetricScatterProps = DataProps<
  ScatterData,
  MetricScatterOptions,
  ChromeProps & { pointHref?: (row: ScatterData["rows"][number]) => string }
>;

/** 两个指标之间的取舍:每个点一个维度值,x / y 各一个指标,series 只决定颜色和分组。 */
export const MetricScatter = makeDataComponent<
  ScatterData,
  MetricScatterOptions,
  ChromeProps & { pointHref?: (row: ScatterData["rows"][number]) => string }
>({
  name: "MetricScatter",
  dataFnName: "metricScatterData",
  shapeName: "ScatterData",
  dataFn: metricScatterData,
  specKeys: ["points", "series", "x", "y", "evals"],
  validate: validateScatterData,
  web: (props, ctx) => (
    <MetricScatterWeb data={props.data} pointHref={props.pointHref} locale={props.locale ?? ctx.locale} className={props.className} />
  ),
  text: (props, ctx) => scatterText(props.data, ctx),
}) as unknown as ReportComponent<MetricScatterProps>;

export type MetricLineProps = DataProps<
  LineData,
  MetricLineOptions,
  ChromeProps & { pointHref?: (row: LineData["rows"][number]) => string }
>;

/** 趋势线:x 是 NumericAxis(参数轴),点身份 = (series, x)。 */
export const MetricLine = makeDataComponent<
  LineData,
  MetricLineOptions,
  ChromeProps & { pointHref?: (row: LineData["rows"][number]) => string }
>({
  name: "MetricLine",
  dataFnName: "metricLineData",
  shapeName: "LineData",
  dataFn: metricLineData,
  specKeys: ["x", "series", "y", "evals"],
  validate: validateLineData,
  web: (props, ctx) => (
    <MetricLineWeb data={props.data} pointHref={props.pointHref} locale={props.locale ?? ctx.locale} className={props.className} />
  ),
  text: (props, ctx) => lineText(props.data, ctx),
}) as unknown as ReportComponent<MetricLineProps>;

export type DeltaTableProps = DataProps<
  DeltaData,
  DeltaTableOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;

/** 成对对比:每行一对(字面声明或 pairsByFlag 派生),格子里 A、B、Δ 三个值。 */
export const DeltaTable = makeDataComponent<
  DeltaData,
  DeltaTableOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "DeltaTable",
  dataFnName: "deltaTableData",
  shapeName: "DeltaData",
  dataFn: deltaTableData,
  specKeys: ["by", "pairs", "metrics", "evals"],
  validate: validateDeltaData,
  web: (props, ctx) => <DeltaTableWeb data={props.data} locale={props.locale ?? ctx.locale} className={props.className} />,
  text: (props, ctx) => deltaText(props.data, ctx),
}) as unknown as ReportComponent<DeltaTableProps>;
