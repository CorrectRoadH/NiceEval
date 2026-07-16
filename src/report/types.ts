// niceeval/report 的公开类型:指标(Metric)、维度(Dimension / flag() / runConfig())与
// 计算函数产物(即组件的 data)。数据契约照 docs/feature/reports/library/ 各分篇;
// 这些不是持久化格式,没有 format / schemaVersion 信封,兼容性跟随 npm 版本
// (组件消费 data 时校验结构,不符按完整用户反馈报错并提示版本漂移)。

import type { AttemptHandle, Scope, ScopeWarning, Snapshot } from "../results/types.ts";
import type { AttemptLocator } from "../results/locator.ts";
import type { ExperimentRunInfo, JsonValue, Verdict } from "../types.ts";
import type { LocalizedText, ReportLocale } from "./locale.ts";

export type { ScopeWarning };
export type { AttemptLocator };
export type { LocalizedText, ReportLocale };

/** 所有官方计算函数的第一参:Scope(warnings 随行)或手工挑的快照数组(没有挑选过程,自然无警告)。 */
export type ReportInput = Scope | readonly Snapshot[];

// ───────────────────────── 指标与聚合 ─────────────────────────

/** 两级聚合里单级的折叠方式。 */
export type Aggregator = "mean" | "sum" | "min" | "max" | ((values: readonly number[]) => number);

/**
 * 两级聚合:「每格 attempt 数相等」是幻觉(earlyExit 让失败的题天然比通过的题样本多),
 * 平铺求均值会让分数和重试策略纠缠;所以先题内折叠、再跨题折叠,默认宏平均。
 */
export interface MetricAggregate {
  /** 第一级:同一 experiment × eval 的多个 attempt 先折成题级值;默认 "mean"。 */
  perEval?: Aggregator;
  /** 第二级:题级值再跨 experiment × eval 折成终值;默认 "mean"。 */
  acrossEvals?: Aggregator;
}

/**
 * 指标:纯函数,吃一个 AttemptHandle 吐一个值(null = 此 attempt 测不了这个指标,
 * 不进聚合;0 = 测了结果是零,照常进),外加名字、两级聚合方式和渲染提示。
 * 内置指标与自定义指标是同一个类型,没有特权。name 走字面量泛型:列键锚在指标
 * 对象上(`row.cells[taskPassRate.name]`),拼错列名编译不过。
 */
export interface Metric<Name extends string = string> {
  /** MetricColumn.key 与列头的来源;同一次计算里重名是错误。 */
  name: Name;
  /** 列头;省略时用 name。渲染面按 locale 解析,缺项走 LocalizedText 回退规则。 */
  label?: LocalizedText;
  description?: LocalizedText;
  /** 驱动内置格式化:"%" → 87%、"ms" → 1.2s、"$" → $0.31、其余 → 1.2k 缩写。 */
  unit?: string;
  /** 渲染提示:越高越好还是越低越好(排序方向、轴向、涨跌配色用)。 */
  better?: "higher" | "lower";
  /**
   * 声明式前置:不满足 → null,语义等价于在 value 开头 return null。
   * 单独设字段是因为这一步最容易忘(忘了它,code-golf 会奖励「写得短的坏代码」)。
   */
  where?: (attempt: AttemptHandle) => boolean;
  value(attempt: AttemptHandle): number | null | Promise<number | null>;
  aggregate?: MetricAggregate;
  /** 覆盖 unit 驱动的内置格式化;只格式化同一个终值,不按 locale 分裂计算口径。 */
  display?: (value: number, locale: ReportLocale) => string;
}

// ───────────────────────── 维度与数值轴 ─────────────────────────

/**
 * 内置维度就是结果已有的身份字段。
 * - "evalGroup" = eval id 的完整父路径("a/b/c" → "a/b";无 "/" 取完整 id,与可比组同一条派生规则)
 * - "snapshot"  = "<experimentId> @ <startedAt>",把两次快照并排成行
 */
export type BuiltInDimension = "agent" | "model" | "experiment" | "eval" | "evalGroup" | "snapshot";

/** 自定义维度:一个函数把 attempt 分到组。 */
export interface CustomDimension {
  name: string;
  of(attempt: AttemptHandle): string;
}

/**
 * flag() / runConfig() 的产物:把 experiment 声明的 flag 或顶层运行配置当分组维度。
 * 读取的 JSON 值可能是任意形状,分组显示键按稳定 JSON 规则生成;缺失值显示内置文案
 * `(missing)`,不同原始值撞出同一显示键时计算报错并要求改用 CustomDimension。
 */
export interface DimensionRef {
  readonly kind: "flag" | "runConfig";
  readonly name: string;
  readonly label?: LocalizedText;
  readonly unit?: string;
}

/** 维度槽的输入:内置维度、自定义维度,或 flag() / runConfig() 的产物。 */
export type DimensionInput = BuiltInDimension | CustomDimension | DimensionRef;

/** MetricLine 的 x 轴:必须是数值;字符串配置显式映射,组件不猜 low < medium < high。 */
export interface NumericAxis {
  name: string;
  label?: LocalizedText;
  unit?: string;
  of(attempt: AttemptHandle): number | null;
}

export interface DimensionOptions {
  label?: LocalizedText;
  unit?: string;
}

export interface NumericAxisOptions extends DimensionOptions {}

export interface NumericRunConfigAxisOptions extends NumericAxisOptions {
  /** 字符串配置到数值轴的显式映射;数值配置不需要。 */
  map?: Readonly<Record<string, number>>;
}

/** runConfig() 的可用键:ExperimentRunInfo 字段全集,外加桥接到快照顶层权威字段的 model / agent。 */
export type RunConfigKey = keyof ExperimentRunInfo | "model" | "agent";

// ───────────────────────── 计算产物(组件 data)─────────────────────────

export interface MetricColumn {
  /** = metric.name,与 cells 的键对应。 */
  key: string;
  /** 数据层原样携带 metric.label(可本地化);渲染面按 locale 解析。 */
  label: LocalizedText;
  description?: LocalizedText;
  unit?: string;
  /** 渲染提示:排序方向、轴向、涨跌配色。 */
  better?: "higher" | "lower";
}

export interface MetricCell {
  /** 聚合后的值;null = 该组没有任何有效样本。 */
  value: number | null;
  /**
   * 已格式化的显示值;计算函数为官方生成面覆盖的每个 locale(当前 en、zh-CN)生成,
   * renderer 按 LocalizedText 回退规则选择,其它 locale 回退 en。
   */
  display: LocalizedText;
  /** 有效 attempt 数(指标返回非 null 的 attempt)。 */
  samples: number;
  /** 本格子覆盖的 attempt 总数,包含值为 null 的 attempt。 */
  total: number;
  /**
   * 本格子覆盖的全部 attempt(包含指标值为 null 的证据)—— 回到证据的引用。必填(可空数组):
   * 「每个数字点进去就是证据」是页面的核心承诺,可选字段会让深链静默缺失。
   */
  refs: AttemptLocator[];
}

/**
 * 数据形状的字段命名规则(docs/feature/reports/library/metric-views.md「共用数据形状」):
 * 维度名字段 = 产生它的选项名 + `Dimension` 后缀,值是解析后的维度 name;
 * 条目数组一律叫 `rows`(Matrix 的稀疏格子叫 `cells`);条目内的 key / series 是维度值,不带后缀。
 */
export interface TableData {
  rowDimension: string;
  columns: MetricColumn[];
  rows: Array<{
    key: string;
    cells: Record<string, MetricCell>;
  }>;
}

export interface MatrixData {
  rowDimension: string;
  columnDimension: string;
  metric: MetricColumn;
  /** 稀疏格子:没有 attempt 的组合不生成格子。 */
  cells: Array<{ row: string; column: string; cell: MetricCell }>;
}

export interface ScatterData {
  pointDimension: string;
  seriesDimension?: string;
  /** 轴方向跟随 better:lower 反向渲染(值大在左/下),「更好」恒指向右上;刻度显示真实值。 */
  x: MetricColumn;
  y: MetricColumn;
  rows: Array<{
    key: string;
    series?: string;
    x: MetricCell;
    /** 任一为 null 的点组件不画,注脚如实报数(点仍留在 rows 里,可数)。 */
    y: MetricCell;
  }>;
}

export interface LineData {
  x: { key: string; label: LocalizedText; unit?: string };
  seriesDimension?: string;
  y: MetricColumn;
  rows: Array<{
    /** 点身份 = (series, x):x 值的稳定十进制字符串,同一 series 内唯一。 */
    key: string;
    series?: string;
    x: number | null;
    xDisplay: LocalizedText;
    y: MetricCell;
  }>;
}

export interface ScoreboardData {
  rowDimension: string;
  questions: string[];
  fullMarks: number;
  /** 实际生效的权重表(最长前缀在前)—— 成绩单可审计。 */
  weights: Array<{ prefix: string; weight: number }>;
  /** Scope 中存在但不在题集内、被忽略的 eval 数(注脚显示)。 */
  ignoredEvals: number;
  rows: Array<{
    key: string;
    total: {
      /** fullMarks × earned / possible。 */
      value: number;
      display: LocalizedText;
      /** 题集中该行完全没有 attempt 的题数(按 0 计,分开计数)。 */
      notRun: number;
      /** 有 attempt 但指标为 null(测不了)的题数(按 0 计,分开计数)。 */
      unscorable: number;
      refs: AttemptLocator[];
    };
    subjects: Array<{
      key: string;
      /** 加权后的 [0, 1] 题目分数之和。 */
      earned: number;
      /** 本分科题目的权重之和。 */
      possible: number;
      questions: number;
      notRun: number;
      unscorable: number;
      display: LocalizedText;
      refs: AttemptLocator[];
    }>;
  }>;
}

export interface DeltaData {
  byDimension: string;
  columns: MetricColumn[];
  /** FlagPairs 派生形态下的配对域实验数;字面 pairs 不携带(空态文案用)。 */
  experiments?: number;
  rows: Array<{
    key: string;
    /** 作者在 DeltaPair 里声明(或派生规则生成)的 label,原样透传;renderer 据此显示行名。 */
    label: LocalizedText;
    a: { key: string };
    b: { key: string };
    cells: Record<
      string,
      {
        a: MetricCell;
        b: MetricCell;
        /** b.value - a.value;任一侧缺失则为 null。 */
        delta: number | null;
        display: LocalizedText;
        outcome: "improved" | "regressed" | "unchanged" | "unavailable";
      }
    >;
  }>;
}

export interface DeltaPair {
  label: LocalizedText;
  a: string;
  b: string;
}

/** pairsByFlag() 的产物:按一个 flag 机械导出全部 A/B 对;只在 by 为 "experiment" 时成立。 */
export interface FlagPairs {
  readonly kind: "flagPairs";
  readonly flag: string;
  /** a 侧的 flag 取值;缺省表示「未声明该 flag」的实验作 a。 */
  readonly baseline?: JsonValue;
}

// ───────────────────────── 概览(ScopeSummary / ExperimentComparison)─────────────────────────

export interface VerdictTally {
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

/**
 * 一个范围的摘要:快照时间窗、experiment / eval / attempt 数、两级判定计票、端到端成功率
 * 和总成本。eval 的身份键是 experimentId + evalId;data 恒携带两级计票,渲染面显示哪一级
 * 由呈现 prop `votes` 决定,不改变 data(docs/feature/reports/library/summaries.md)。
 */
export interface ScopeSummaryData {
  /** 贡献当前数据的快照时间范围;空范围为 null,不编造当前时间。 */
  range: { earliestStartedAt: string | null; latestStartedAt: string | null };
  experiments: number;
  /** experimentId + evalId 的去重计数,与 evalVerdicts 同分母。 */
  evals: number;
  attempts: number;
  /** 每个 experimentId + evalId 先折成最终 verdict 后计票。 */
  evalVerdicts: VerdictTally;
  /** attempt 原始计票,不折叠。 */
  attemptVerdicts: VerdictTally;
  /** 官方两级 endToEndPassRate,不从任一计票重算。 */
  endToEndPassRate: MetricCell;
  /** costUSD 按 attempt 求和;缺失成本不伪造为 0。 */
  totalCostUSD: MetricCell;
}

/** 一个可比组的数据;三个子块都只消费本组快照,不能含其它父目录的引用。 */
export interface ExperimentComparisonGroupData {
  /** experiment id 的完整父路径;根目录 experiment 使用完整 id。 */
  key: string;
  summary: ScopeSummaryData;
  scatter: ScatterData;
  experiments: ExperimentListItem[];
}

export interface ExperimentComparisonData {
  groups: ExperimentComparisonGroupData[];
}

// ───────────────────────── 实体列表(ExperimentList / EvalList / AttemptList)─────────────────────────
//
// 三个组件按「experiment → experimentId × eval → attempt」逐级下钻,固定展示实体事实,
// 没有列配置。每一级都以下一级的 `AttemptListItem[]` 收尾——同一个类型既是 `AttemptList`
// 自己的 data,也是 `ExperimentListEvalRow.attempts` / `EvalListItem.attempts` 的元素。

/**
 * `AttemptList` 一项 = 一次 attempt:身份、判定、算好的单行结果摘要与证据引用。
 * 完整 assertions、Judge evidence、diagnostics、cause 与 stack 不进列表 data;
 * 需要完整结构时经 locator 回读取面(resolveLocator → AttemptHandle)。
 */
export interface AttemptListItem {
  experimentId: string;
  evalId: string;
  attempt: number;
  agent: string;
  verdict: Verdict;
  /**
   * 该轮的单行结果摘要,已按 Scoring display 契约折好:failed 取主失败断言摘要,
   * errored 取结构化 error 的一层摘要(phase · code · message),passed / skipped 为 null。
   * 渲染面只做宽度截断,不重算摘要。
   */
  failureSummary: string | null;
  /** 主失败之外还有几条失败断言("+N more failures" 的 N);无失败为 0。 */
  moreFailures: number;
  /** 当前 attempt 的 examScore 与证据引用。 */
  examScore: MetricCell;
  durationMs: number;
  /** 缺失为 null(测不了),不伪造 0;attempt 级条目的缺失一律用 null,不用省略字段。 */
  costUSD: number | null;
  locator: AttemptLocator;
}

/**
 * `EvalList` 一项 = 一个 `experimentId + evalId`(同一个 Eval 跑在两个 experiment 上是
 * 两条不同结果,不合并)。失败原因只存在于各 AttemptListItem,不在 Eval 父项重复一份。
 */
export interface EvalListItem {
  experimentId: string;
  evalId: string;
  /** 任一轮 passed 即 passed,否则 failed > errored > skipped。 */
  verdict: Verdict;
  examScore: MetricCell;
  durationMs: MetricCell;
  costUSD: MetricCell;
  attempts: AttemptListItem[];
}

/** `ExperimentList` 一项里,一个 Eval 的展开行。 */
export interface ExperimentListEvalRow {
  evalId: string;
  verdict: Verdict;
  durationMs: MetricCell;
  costUSD: MetricCell;
  attempts: AttemptListItem[];
}

/**
 * `experimentListData` 的一项 = 一个 experiment:身份(experimentId/agent/model)、
 * 声明的 flags、eval 级最终 verdict 计票、官方两级聚合汇总指标,以及展开到每道 Eval 的
 * `evalRows`(按 eval id 升序)。一行只有一套 agent / model / flags 是输入约束:
 * 同一 experiment 混入不一致可比性配置时计算按完整用户反馈失败。
 */
export interface ExperimentListItem {
  experimentId: string;
  agent: string;
  model?: string;
  flags?: Record<string, JsonValue>;
  /** eval 级最终 verdict 计票(Result 列的构成)。 */
  evalVerdicts: VerdictTally;
  endToEndPassRate: MetricCell;
  costUSD: MetricCell;
  durationMs: MetricCell;
  tokens: MetricCell;
  /** 这个 experiment 覆盖的 eval 数(去重后,与 evalVerdicts 四项之和一致)。 */
  evals: number;
  /** 这个 experiment 覆盖的 attempt 总数(原始计数,含多轮重试)。 */
  attempts: number;
  /** 所含快照中最近的 startedAt。 */
  lastRunAt: string;
  evalRows: ExperimentListEvalRow[];
}
