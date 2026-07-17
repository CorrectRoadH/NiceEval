// 计算函数(*Data):ReportInput → 一份组件数据。跑在 Node 侧,产物是算好的、可序列化的
// 普通 JSON(终值 + 渲染提示,不含公式);渲染面(web/text)只做展示。
// 它们是双面组件解析面的具名形式(MetricTable / metricTableData),与组件成对导出,
// 只住在 niceeval/report(docs/feature/reports/library.md「数据计算与缓存边界」)。
//
// 共同约定(docs/feature/reports/architecture.md「指标聚合不变量」):
// - 第一参收 ReportInput = Scope | readonly Snapshot[];warnings 不进组件数据(宿主统一显示);
// - 聚合前按身份键去重(dedupeAttempts;missing-startedAt 不去重、如实保留、不透出警告);
// - null ≠ 0:缺数据不编数,覆盖率经 samples/total 如实暴露;
// - 显式传入的列表(questions / pairs / metrics)保留声明顺序,从数据发现的维度 domain
//   按稳定 key 字典序;
// - core 中立:只认 Metric / Dimension 接口,不出现具体 agent 名的分支。

import type {
  AttemptListItem,
  AttemptLocator,
  CopyFixPromptData,
  DeltaData,
  DeltaPair,
  DimensionInput,
  EvalListItem,
  ExperimentComparisonData,
  ExperimentComparisonGroupData,
  ExperimentListEvalRow,
  ExperimentListItem,
  FlagPairs,
  HeroData,
  LineData,
  MatrixData,
  Metric,
  MetricCell,
  NumericAxis,
  ReportInput,
  ScatterData,
  ScopeSummaryData,
  ScopeWarning,
  ScoreboardData,
  TableData,
  TraceSpanSummary,
  TraceWaterfallRow,
  VerdictTally,
} from "./types.ts";
import type { EvalResult, JsonValue, TraceSpan } from "../types.ts";
import type { Snapshot } from "../results/types.ts";
import { comparabilityConfigOf, deepEqualJson } from "../results/select.ts";
import { evalLevelStats, foldEvalVerdict } from "../shared/verdict.ts";
import { experimentGroupOf } from "../shared/aggregate.ts";
import {
  assertUniqueMetricNames,
  axisValueOf,
  collectItems,
  computeCell,
  dimensionKey,
  dimensionName,
  displayValue,
  evalGroupOf,
  evalIdOf,
  evaluateMetric,
  experimentIdOf,
  filterItems,
  fullEvalKey,
  groupItems,
  locatorOf,
  refDisplayKey,
  resolveInput,
  snapshotKeyOf,
  toColumn,
  type Item,
} from "./aggregate.ts";
import { attemptCostUSD, costUSD, durationMs, endToEndPassRate, examScore, tokens } from "./metrics.ts";
import { formatMetricValue, formatPlainNumber, localizedDisplay } from "./format.ts";
import { compactAssertionSummary, primaryAssertionSummary, summaryText } from "../scoring/display.ts";
import { defineMetric } from "./metrics.ts";
import type { LocalizedText } from "./locale.ts";

// ───────────────────────── metricTableData ─────────────────────────

export interface MetricTableOptions {
  /** 行维度(内置 / 自定义 / flag() / runConfig())。 */
  rows: DimensionInput;
  /** 每列一个指标;非空元组,元素是静态 import 的 Metric 实例。 */
  columns: readonly [Metric, ...Metric[]];
  /**
   * 初始行序:必须是 columns 中同一个 Metric 实例且声明了 better,方向随 better
   * (「好」的一头在上),缺数据行沉底;省略时按行 key 字典序。
   */
  sort?: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义;在聚合之前收窄题集。 */
  evals?: string | readonly string[];
}

export async function metricTableData(input: ReportInput, options: MetricTableOptions): Promise<TableData> {
  assertUniqueMetricNames(options.columns, "metricTableData columns");
  if (options.sort !== undefined) {
    if (!options.columns.includes(options.sort)) {
      throw new Error(
        `metricTableData sort must be one of the Metric instances passed in columns (got "${options.sort.name}"). ` +
          "Pass the same imported instance in both places so the sorted column is visible in the table.",
      );
    }
    if (options.sort.better === undefined) {
      throw new Error(
        `metricTableData cannot sort by "${options.sort.name}": the metric declares no "better" direction, so there is no defined order. ` +
          'Declare better: "higher" | "lower" on the metric, or drop sort to keep the lexicographic row order.',
      );
    }
  }
  const { snapshots } = resolveInput(input);
  const items = filterItems(collectItems(snapshots), options.evals);
  const groups = groupItems(items, options.rows);
  const rows: TableData["rows"] = [];
  for (const [key, group] of groups) {
    const cells: Record<string, MetricCell> = {};
    for (const metric of options.columns) cells[metric.name] = await computeCell(metric, group);
    rows.push({ key, cells });
  }
  if (options.sort) {
    const better = options.sort.better ?? "higher";
    const name = options.sort.name;
    rows.sort((a, b) => {
      const va = a.cells[name]?.value ?? null;
      const vb = b.cells[name]?.value ?? null;
      if (va === null && vb === null) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      if (va === null) return 1; // 缺数据沉底
      if (vb === null) return -1;
      const diff = better === "lower" ? va - vb : vb - va;
      if (diff !== 0) return diff;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; // 稳定排序,同值以 key 收口
    });
  }
  return {
    rowDimension: dimensionName(options.rows),
    columns: options.columns.map(toColumn),
    rows,
  };
}

// ───────────────────────── metricMatrixData(= MetricBars 的数据)─────────────────────────

export interface MetricMatrixOptions {
  rows: DimensionInput;
  columns: DimensionInput;
  cell: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

export async function metricMatrixData(input: ReportInput, options: MetricMatrixOptions): Promise<MatrixData> {
  const { snapshots } = resolveInput(input);
  const items = filterItems(collectItems(snapshots), options.evals);
  // 稀疏分组:只有真有 attempt 的 (row, column) 组合成格;没有样本的格子不出现
  const groups = new Map<string, { row: string; column: string; items: Item[] }>();
  for (const item of items) {
    const row = dimensionKey(options.rows, item);
    const column = dimensionKey(options.columns, item);
    const key = JSON.stringify([row, column]);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { row, column, items: [item] });
  }
  const ordered = [...groups.values()].sort(
    (a, b) => (a.row < b.row ? -1 : a.row > b.row ? 1 : a.column < b.column ? -1 : a.column > b.column ? 1 : 0),
  );
  const cells: MatrixData["cells"] = [];
  for (const group of ordered) {
    cells.push({ row: group.row, column: group.column, cell: await computeCell(options.cell, group.items) });
  }
  return {
    rowDimension: dimensionName(options.rows),
    columnDimension: dimensionName(options.columns),
    metric: toColumn(options.cell),
    cells,
  };
}

// ───────────────────────── 实体列表(experimentListData / evalListData / attemptListData)─────────────────────────

/**
 * 一次 attempt 的单行结果摘要(Scoring display 契约):failed 取主失败断言摘要(不含
 * "+N more",N 单独进 moreFailures),errored 取结构化 error 的一层摘要
 * (phase · code · message),passed / skipped 为 null。
 */
function failureSummaryOf(result: EvalResult): { summary: string | null; more: number } {
  if (result.verdict === "errored" && result.error !== undefined) {
    const parts = [result.error.phase, result.error.code, result.error.message].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return { summary: summaryText(parts.join(" · ")), more: 0 };
  }
  if (result.verdict === "failed" || result.verdict === "errored") {
    const primary = primaryAssertionSummary(result.assertions, result.verdict);
    if (primary !== undefined) {
      return {
        summary: compactAssertionSummary({ ...primary, additionalFailures: 0 }),
        more: primary.additionalFailures,
      };
    }
    if (result.verdict === "errored" && result.skipReason !== undefined) {
      return { summary: summaryText(result.skipReason), more: 0 };
    }
    return { summary: null, more: 0 };
  }
  return { summary: null, more: 0 };
}

/** AttemptList / ExperimentList / EvalList 共用的叶子构造:一个 Item → 一个 AttemptListItem。 */
async function attemptListItemOf(item: Item): Promise<AttemptListItem> {
  const result = item.attempt.result;
  const { summary, more } = failureSummaryOf(result);
  return {
    experimentId: experimentIdOf(item),
    evalId: evalIdOf(item),
    attempt: result.attempt,
    agent: result.agent,
    verdict: result.verdict,
    failureSummary: summary,
    moreFailures: more,
    examScore: await computeCell(examScore, [item]),
    durationMs: result.durationMs,
    costUSD: attemptCostUSD(result),
    locator: locatorOf(item),
  };
}

/** `attemptListData(input)`:每个 Attempt 一项,顺序取自 Scope 展平顺序(不重排)。 */
export async function attemptListData(input: ReportInput): Promise<AttemptListItem[]> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  return Promise.all(items.map((item) => attemptListItemOf(item)));
}

/** `evalListData(input)`:每个 `experimentId + evalId` 一项,按 evalId 再按 experimentId 升序。 */
export async function evalListData(input: ReportInput): Promise<EvalListItem[]> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = fullEvalKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const out: EvalListItem[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.attempt.result.attempt - b.attempt.result.attempt);
    const verdict = foldEvalVerdict(sorted.map((item) => item.attempt.result));
    const attempts = await Promise.all(sorted.map((item) => attemptListItemOf(item)));
    out.push({
      experimentId: experimentIdOf(sorted[0]!),
      evalId: evalIdOf(sorted[0]!),
      verdict,
      examScore: await computeCell(examScore, sorted),
      durationMs: await computeCell(durationMs, sorted),
      costUSD: await computeCell(costUSD, sorted),
      attempts,
    });
  }
  out.sort((a, b) => a.evalId.localeCompare(b.evalId) || a.experimentId.localeCompare(b.experimentId));
  return out;
}

/**
 * `experimentListData(input)`:每个 experiment 一项,展开到每道 Eval;初始按端到端成功率
 * 从高到低(缺数据沉底,同分按 id)。一行只有一套 agent / model / flags 是输入约束:
 * 宿主注入的 current() Scope 保证每个 experiment 只由可比性配置一致的快照拼成;作者自选
 * Snapshot[] 时若同一 experiment 混入不一致的可比性配置,按完整用户反馈失败并指引——
 * 看跨配置演化用 snapshot 维度或 MetricLine,不把两套配置拼成一行冒充单一配置。
 */
export async function experimentListData(input: ReportInput): Promise<ExperimentListItem[]> {
  const { snapshots } = resolveInput(input);

  // 可比性配置单义检查:同一 experiment 的输入快照必须共享一套可比性配置。
  const configByExperiment = new Map<string, { snapshot: Snapshot; config: unknown }>();
  for (const snapshot of snapshots) {
    const config = comparabilityConfigOf(snapshot);
    const existing = configByExperiment.get(snapshot.experimentId);
    if (existing === undefined) {
      configByExperiment.set(snapshot.experimentId, { snapshot, config });
    } else if (!deepEqualJson(existing.config, config)) {
      throw new Error(
        `experimentListData got inconsistent comparability configs for experiment "${snapshot.experimentId}" ` +
          `(snapshots ${existing.snapshot.startedAt} and ${snapshot.startedAt} differ in agent/model/reasoningEffort/flags/budget/timeoutMs/sandbox). ` +
          "One row shows one configuration — it cannot honestly merge two. To chart evolution across configs, " +
          'use the "snapshot" dimension or MetricLine; to show the current level, pass results.current() which selects a single config per experiment.',
      );
    }
  }

  const items = collectItems(snapshots);
  const groups = groupItems(items, "experiment");
  const out: ExperimentListItem[] = [];
  for (const [experimentId, group] of groups) {
    const stats = summarizeItems(group);
    const newest = [...group].sort((a, b) => b.snapshot.startedAt.localeCompare(a.snapshot.startedAt))[0]!;
    const evalGroups = groupItems(group, "eval");
    const evalRows: ExperimentListEvalRow[] = [];
    for (const [evalId, evalItems] of evalGroups) {
      const sorted = [...evalItems].sort((a, b) => a.attempt.result.attempt - b.attempt.result.attempt);
      const verdict = foldEvalVerdict(sorted.map((item) => item.attempt.result));
      const attempts = await Promise.all(sorted.map((item) => attemptListItemOf(item)));
      evalRows.push({
        evalId,
        verdict,
        durationMs: await computeCell(durationMs, sorted),
        costUSD: await computeCell(costUSD, sorted),
        attempts,
      });
    }
    const experiment = newest.snapshot.experiment ?? newest.attempt.result.experiment;
    const model = newest.attempt.result.model ?? newest.snapshot.model;
    out.push({
      experimentId,
      agent: newest.snapshot.agent || newest.attempt.result.agent,
      ...(model !== undefined ? { model } : {}),
      ...(experiment?.flags ? { flags: experiment.flags } : {}),
      evalVerdicts: stats.verdicts,
      endToEndPassRate: await computeCell(endToEndPassRate, group),
      costUSD: await computeCell(costUSD, group),
      durationMs: await computeCell(durationMs, group),
      tokens: await computeCell(tokens, group),
      evals: stats.evals,
      attempts: stats.attempts,
      lastRunAt: stats.lastRunAt!,
      evalRows,
    });
  }
  // 初始态按端到端成功率(endToEndPassRate)从高到低,缺数据沉底;同分按 experiment id 稳定排序。
  out.sort((a, b) => {
    const va = a.endToEndPassRate.value;
    const vb = b.endToEndPassRate.value;
    if (va === null && vb === null) return a.experimentId.localeCompare(b.experimentId);
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || a.experimentId.localeCompare(b.experimentId);
  });
  return out;
}

// ───────────────────────── scopeSummaryData ─────────────────────────

/** costUSD 的求和投影:两级都 sum(题内多轮求和 + 跨题求和 = 全量求和),display 走 $。 */
const totalCostMetric = defineMetric({
  name: "total-cost",
  label: costUSD.label,
  unit: "$",
  value: costUSD.value,
  aggregate: { perEval: "sum", acrossEvals: "sum" },
});

function tallyOf(): VerdictTally {
  return { passed: 0, failed: 0, errored: 0, skipped: 0 };
}

/** 一批 Item 的组级统计(experimentListData / scopeSummaryData 共用)。 */
function summarizeItems(items: Item[]): {
  experiments: number;
  evals: number;
  attempts: number;
  verdicts: VerdictTally;
  lastRunAt: string | undefined;
} {
  const experimentIds = new Set<string>();
  for (const item of items) experimentIds.add(experimentIdOf(item));
  const stats = evalLevelStats(
    items.map((item) => ({ verdict: item.attempt.result.verdict, key: fullEvalKey(item) })),
    (r) => r.key,
  );
  let lastRunAt: string | undefined;
  for (const item of items) {
    const startedAt = item.snapshot.startedAt;
    if (lastRunAt === undefined || startedAt > lastRunAt) lastRunAt = startedAt;
  }
  return {
    experiments: experimentIds.size,
    evals: stats.evals,
    attempts: items.length,
    verdicts: { passed: stats.passed, failed: stats.failed, errored: stats.errored, skipped: stats.skipped },
    lastRunAt,
  };
}

/**
 * `scopeSummaryData(input)`:范围摘要——快照时间窗、experiment / eval / attempt 数、
 * 两级判定计票、端到端成功率与总成本(docs/feature/reports/library/summaries.md)。
 * data 恒携带两级计票;成功率来自官方两级指标引擎,不从任一计票重算。
 */
export async function scopeSummaryData(input: ReportInput): Promise<ScopeSummaryData> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);

  let earliest: string | null = null;
  let latest: string | null = null;
  for (const snapshot of snapshots) {
    if (earliest === null || snapshot.startedAt < earliest) earliest = snapshot.startedAt;
    if (latest === null || snapshot.startedAt > latest) latest = snapshot.startedAt;
  }

  const stats = summarizeItems(items);
  const attemptVerdicts = tallyOf();
  for (const item of items) attemptVerdicts[item.attempt.result.verdict] += 1;

  return {
    range: { earliestStartedAt: earliest, latestStartedAt: latest },
    experiments: stats.experiments,
    evals: stats.evals,
    attempts: stats.attempts,
    evalVerdicts: stats.verdicts,
    attemptVerdicts,
    endToEndPassRate: await computeCell(endToEndPassRate, items),
    totalCostUSD: await computeCell(totalCostMetric, items),
  };
}

// ───────────────────────── experimentComparisonData ─────────────────────────

/** 完整父路径是组键;没有父路径的 experiment 不能互相比,自己形成单例组。 */
export function experimentComparisonGroupKey(experimentId: string): string {
  return experimentGroupOf(experimentId) ?? experimentId;
}

/** 每组散点的唯一口径:默认 definition 与公开计算共用,不各写一份。 */
const COMPARISON_SCATTER_OPTIONS: MetricScatterOptions = {
  points: "experiment",
  series: "agent",
  x: costUSD,
  y: endToEndPassRate,
};

/**
 * `experimentComparisonData(input)`:先把 input 按可比组分区(experiment id 的完整父路径),
 * 再为每组分别计算 ScopeSummary、成本 × 端到端成功率散点和 ExperimentList——分区发生在任何
 * 指标计算之前,组外 attempt 不可能污染该组的坐标尺度、series、成功率、成本、排序或缺数据计数。
 */
export async function experimentComparisonData(input: ReportInput): Promise<ExperimentComparisonData> {
  const { snapshots } = resolveInput(input);
  const snapshotsByGroup = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots) {
    const key = experimentComparisonGroupKey(snapshot.experimentId);
    const group = snapshotsByGroup.get(key);
    if (group) group.push(snapshot);
    else snapshotsByGroup.set(key, [snapshot]);
  }
  const groups = await Promise.all(
    [...snapshotsByGroup.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(async ([key, groupSnapshots]): Promise<ExperimentComparisonGroupData> => {
        const [summary, scatter, experiments] = await Promise.all([
          scopeSummaryData(groupSnapshots),
          metricScatterData(groupSnapshots, COMPARISON_SCATTER_OPTIONS),
          experimentListData(groupSnapshots),
        ]);
        return { key, summary, scatter, experiments };
      }),
  );
  return { groups };
}

// ───────────────────────── scoreboardData ─────────────────────────

export interface ScoreboardOptions {
  rows: DimensionInput;
  /** 固定题集;eval id 必须唯一。元素引用运行时数据,类型放宽为普通数组,空数组在计算时报错。 */
  questions: readonly string[];
  /** 分科函数;默认与 evalGroup 维度同一条规则:取 eval id 的完整父路径,无 `/` 取完整 id。 */
  subject?: (evalId: string) => string;
  /** 权重按 eval id 前缀匹配,多个命中时最长前缀生效;默认 1。 */
  weights?: Readonly<Record<string, number>>;
  fullMarks?: number;
  score?: Metric;
}

/**
 * 固定题集分母:未跑题按 0 分计入 `notRun`,跑了但指标为 null 的题按 0 分计入 `unscorable`,
 * 两个计数不合并——成绩单能回答「这 0 分是没去考还是考了判不了」。组件不从已观测 attempt
 * 的并集猜分母;Scope 中题集之外的 eval 被忽略并计入 `ignoredEvals`。
 */
export async function scoreboardData(input: ReportInput, options: ScoreboardOptions): Promise<ScoreboardData> {
  const questions = options.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(
      "scoreboardData questions must be a non-empty list of eval ids: the fixed question set is the denominator, and an empty denominator makes no scoreboard. " +
        "Pass the eval ids to grade, or filter your source list before passing it.",
    );
  }
  const seen = new Set<string>();
  for (const q of questions) {
    if (seen.has(q)) {
      throw new Error(
        `scoreboardData questions contains "${q}" twice — each question is one denominator slot; remove the duplicate.`,
      );
    }
    seen.add(q);
  }
  const fullMarks = options.fullMarks ?? 100;
  if (!Number.isFinite(fullMarks) || fullMarks <= 0) {
    throw new Error(`scoreboardData fullMarks must be a positive finite number (got ${String(fullMarks)}).`);
  }
  const weightEntries = Object.entries(options.weights ?? {});
  for (const [prefix, weight] of weightEntries) {
    if (prefix.length === 0) {
      throw new Error('scoreboardData weights contains an empty prefix ""; weight prefixes must be non-empty eval id prefixes.');
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(
        `scoreboardData weight for prefix "${prefix}" must be a positive finite number (got ${String(weight)}).`,
      );
    }
  }
  const scoreMetric = options.score ?? examScore;
  const subjectOf = options.subject ?? evalGroupOf;

  const { snapshots } = resolveInput(input);
  const allItems = collectItems(snapshots);
  const questionSet = new Set(questions);
  const items = allItems.filter((item) => questionSet.has(evalIdOf(item)));
  const ignored = new Set<string>();
  for (const item of allItems) {
    const id = evalIdOf(item);
    if (!questionSet.has(id)) ignored.add(id);
  }

  // 权重:最长前缀生效(排序后线性找第一个命中即最长)
  const weights = weightEntries
    .map(([prefix, weight]) => ({ prefix, weight }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const weightOf = (id: string): number => weights.find((w) => id.startsWith(w.prefix))?.weight ?? 1;

  const subjectByQuestion = new Map<string, string>();
  for (const id of questions) {
    const subject = subjectOf(id);
    if (typeof subject !== "string" || subject.length === 0) {
      throw new Error(
        `scoreboardData subject("${id}") returned an empty value; every question must map to a non-empty subject name.`,
      );
    }
    subjectByQuestion.set(id, subject);
  }

  const groups = groupItems(items, options.rows);
  const rows: ScoreboardData["rows"] = [];
  for (const [key, group] of groups) {
    const byQuestion = new Map<string, Item[]>();
    for (const item of group) {
      const id = evalIdOf(item);
      const list = byQuestion.get(id);
      if (list) list.push(item);
      else byQuestion.set(id, [item]);
    }

    const subjects = new Map<
      string,
      {
        key: string;
        earned: number;
        possible: number;
        questions: number;
        notRun: number;
        unscorable: number;
        refs: Set<AttemptLocator>;
      }
    >();
    const totalRefs = new Set<AttemptLocator>();
    for (const id of questions) {
      const subjectKey = subjectByQuestion.get(id)!;
      let subject = subjects.get(subjectKey);
      if (!subject) {
        subjects.set(
          subjectKey,
          (subject = { key: subjectKey, earned: 0, possible: 0, questions: 0, notRun: 0, unscorable: 0, refs: new Set() }),
        );
      }
      const weight = weightOf(id);
      subject.possible += weight;
      subject.questions += 1;
      const questionItems = byQuestion.get(id);
      if (questionItems === undefined) {
        subject.notRun += 1;
        continue;
      }
      for (const item of questionItems) {
        const locator = locatorOf(item);
        subject.refs.add(locator);
        totalRefs.add(locator);
      }
      const cell = await computeCell(scoreMetric, questionItems);
      if (cell.value === null) {
        subject.unscorable += 1;
        continue;
      }
      if (cell.value < 0 || cell.value > 1) {
        throw new Error(
          `scoreboardData score metric "${scoreMetric.name}" produced ${cell.value} for eval "${id}" — scores must stay in [0, 1] so weighted totals stay auditable. Normalize the metric, or use a different score metric.`,
        );
      }
      subject.earned += cell.value * weight;
    }

    let earned = 0;
    let possible = 0;
    let notRun = 0;
    let unscorable = 0;
    for (const subject of subjects.values()) {
      earned += subject.earned;
      possible += subject.possible;
      notRun += subject.notRun;
      unscorable += subject.unscorable;
    }
    const value = possible === 0 ? 0 : (fullMarks * earned) / possible;
    rows.push({
      key,
      total: {
        value,
        display: formatPlainNumber(value),
        notRun,
        unscorable,
        refs: [...totalRefs].sort(),
      },
      subjects: [...subjects.values()].map((subject) => ({
        key: subject.key,
        earned: subject.earned,
        possible: subject.possible,
        questions: subject.questions,
        notRun: subject.notRun,
        unscorable: subject.unscorable,
        display: subjectDisplay(subject.earned, subject.possible),
        refs: [...subject.refs].sort(),
      })),
    });
  }

  return {
    rowDimension: dimensionName(options.rows),
    questions: [...questions],
    fullMarks,
    weights,
    ignoredEvals: ignored.size,
    rows,
  };
}

/** 分科显示:earned / possible 与同尺度百分比。 */
function subjectDisplay(earned: number, possible: number): LocalizedText {
  const ratio = possible === 0 ? 0 : earned / possible;
  return `${formatPlainNumber(earned)}/${formatPlainNumber(possible)} (${formatMetricValue(ratio, "%")})`;
}

// ───────────────────────── metricScatterData ─────────────────────────

export interface MetricScatterOptions {
  /** 点维度:每个点 = 该组 attempt 的聚合。 */
  points: DimensionInput;
  /** 可选:只决定颜色和分组,默认不连线。 */
  series?: DimensionInput;
  x: Metric;
  y: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

export async function metricScatterData(input: ReportInput, options: MetricScatterOptions): Promise<ScatterData> {
  const { snapshots } = resolveInput(input);
  const items = filterItems(collectItems(snapshots), options.evals);
  const groups = groupItems(items, options.points);
  const rows: ScatterData["rows"] = [];
  for (const [key, group] of groups) {
    rows.push({
      key,
      // 组内取第一条解析系列:点维度细于系列维度时(experiment ⊂ agent)天然一致
      ...(options.series ? { series: dimensionKey(options.series, group[0]!) } : {}),
      x: await computeCell(options.x, group),
      y: await computeCell(options.y, group), // 任一轴 null 的点留在 rows 里:组件不画,但注脚要报的数就从这里数
    });
  }
  return {
    pointDimension: dimensionName(options.points),
    ...(options.series ? { seriesDimension: dimensionName(options.series) } : {}),
    x: toColumn(options.x),
    y: toColumn(options.y),
    rows,
  };
}

// ───────────────────────── metricLineData ─────────────────────────

export interface MetricLineOptions {
  /** x 轴:NumericAxis(numericFlag() / numericRunConfig() 或自定义 of),不解析 experiment 命名。 */
  x: NumericAxis;
  series?: DimensionInput;
  y: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

/**
 * 点身份 = (series, x):落进同一桶的全部 attempt 先在各自 experiment × eval 内 perEval 聚合,
 * 再 acrossEvals 跨题折成该点唯一的 y——聚合顺序是 (series, x, experiment, eval),同一桶里有
 * 多个 experiment 时它们合成一个点,不画垂直来回线。前提是 x 在同一 experiment × eval 内恒定:
 * 自定义 NumericAxis.of() 对同一 experiment × eval 的不同 attempt 返回不同值时按完整用户反馈失败。
 * x 为 null 的 attempt 不伪造 x 值,归入该 series 的未绘制行,组件报告未绘制数量。
 */
export async function metricLineData(input: ReportInput, options: MetricLineOptions): Promise<LineData> {
  const { snapshots } = resolveInput(input);
  const items = filterItems(collectItems(snapshots), options.evals);

  // x 恒定性检查:同一 experiment × eval 内的全部 attempt 必须得到同一个 x。
  const xByEvalKey = new Map<string, { x: number | null; item: Item }>();
  const buckets = new Map<string, { series: string | undefined; x: number | null; items: Item[] }>();
  for (const item of items) {
    const x = axisValueOf(options.x, item.attempt);
    const evalKey = fullEvalKey(item);
    const existing = xByEvalKey.get(evalKey);
    if (existing === undefined) {
      xByEvalKey.set(evalKey, { x, item });
    } else if (!Object.is(existing.x, x)) {
      throw new Error(
        `Numeric axis "${options.x.name}" is not constant within experiment "${experimentIdOf(item)}" × eval "${evalIdOf(item)}" ` +
          `(got ${String(existing.x)} and ${String(x)} for different attempts). A parameter axis must describe the configuration, ` +
          "not vary per attempt — a per-attempt quantity is material for the y metric, not an x axis. " +
          "Fix of() to read experiment-level configuration (numericFlag()/numericRunConfig() do this by construction).",
      );
    }
    const series = options.series ? dimensionKey(options.series, item) : undefined;
    const bucketKey = `${series ?? ""} ${x === null ? "null" : String(x)}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.items.push(item);
    else buckets.set(bucketKey, { series, x, items: [item] });
  }

  const ordered = [...buckets.values()].sort((a, b) => {
    const sa = a.series ?? "";
    const sb = b.series ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    if (a.x === null) return b.x === null ? 0 : 1;
    if (b.x === null) return -1;
    return a.x - b.x;
  });

  const rows: LineData["rows"] = [];
  for (const bucket of ordered) {
    rows.push({
      key: bucket.x === null ? "null" : String(bucket.x),
      ...(bucket.series !== undefined ? { series: bucket.series } : {}),
      x: bucket.x,
      xDisplay: bucket.x === null ? "—" : formatMetricValue(bucket.x, options.x.unit),
      y: await computeCell(options.y, bucket.items),
    });
  }

  return {
    x: {
      key: options.x.name,
      label: options.x.label ?? options.x.name,
      ...(options.x.unit !== undefined ? { unit: options.x.unit } : {}),
    },
    ...(options.series ? { seriesDimension: dimensionName(options.series) } : {}),
    y: toColumn(options.y),
    rows,
  };
}

// ───────────────────────── deltaTableData 与 pairsByFlag ─────────────────────────

/**
 * 按 flag 派生 A/B 对(docs/feature/reports/library/metric-views.md「DeltaTable」):
 * 配对域 = 同可比组 + 删除该 flag 后可比性配置深相等;a 取 baseline(缺省 = 未声明该 flag),
 * b 侧该 flag 的每个其它取值各成一对;label 自动 `<a 末段> · <flag>=<显示键>`。
 */
export function pairsByFlag(name: string, options?: { baseline?: JsonValue }): FlagPairs {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("pairsByFlag: name must be a non-empty string (the key declared in the experiment's flags).");
  }
  return {
    kind: "flagPairs",
    flag: name,
    ...(options?.baseline !== undefined ? { baseline: options.baseline } : {}),
  };
}

export interface DeltaTableOptions {
  /** 显式维度,必填——"baseline" 不会被猜成 experiment、agent、flag 或 snapshot 中的某一种。 */
  by: DimensionInput;
  /** 字面 pair 数组(自定义 label),或 pairsByFlag() 的派生声明;空数组在计算时报错。 */
  pairs: readonly DeltaPair[] | FlagPairs;
  metrics: readonly [Metric, ...Metric[]];
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

function isFlagPairs(pairs: DeltaTableOptions["pairs"]): pairs is FlagPairs {
  return typeof pairs === "object" && pairs !== null && !Array.isArray(pairs) && (pairs as FlagPairs).kind === "flagPairs";
}

/** experiment id 相对可比组的末段。 */
function experimentTail(experimentId: string): string {
  const slash = experimentId.lastIndexOf("/");
  return slash === -1 ? experimentId : experimentId.slice(slash + 1);
}

/** 派生配对:同可比组 + 删除该 flag 后可比性配置深相等。返回 pair 列表与配对域实验数。 */
function derivePairsByFlag(
  snapshots: readonly Snapshot[],
  spec: FlagPairs,
): { pairs: DeltaPair[]; experiments: number } {
  // 每个 experiment 取最新快照的配置(current() Scope 天然一实验一快照)。
  const byExperiment = new Map<string, Snapshot>();
  for (const snapshot of snapshots) {
    const existing = byExperiment.get(snapshot.experimentId);
    if (existing === undefined || snapshot.startedAt > existing.startedAt) {
      byExperiment.set(snapshot.experimentId, snapshot);
    }
  }
  interface Entry {
    id: string;
    flagValue: JsonValue | undefined;
    bucket: string;
  }
  const entries: Entry[] = [];
  for (const [id, snapshot] of byExperiment) {
    const config = comparabilityConfigOf(snapshot) as { flags?: Record<string, JsonValue> };
    const flagValue = config.flags?.[spec.flag];
    const reduced = { ...config, flags: { ...config.flags } };
    delete reduced.flags[spec.flag];
    const group = experimentGroupOf(id) ?? id;
    entries.push({ id, flagValue, bucket: `${group} ${JSON.stringify(sortedJson(reduced))}` });
  }

  const baseline = spec.baseline; // undefined = 未声明该 flag 的实验作 a
  const buckets = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = buckets.get(entry.bucket);
    if (list) list.push(entry);
    else buckets.set(entry.bucket, [entry]);
  }

  const pairs: DeltaPair[] = [];
  for (const bucket of buckets.values()) {
    const aSide = bucket.filter((e) => deepEqualJson(e.flagValue, baseline));
    const bSide = bucket.filter((e) => !deepEqualJson(e.flagValue, baseline));
    for (const a of aSide) {
      for (const b of bSide) {
        pairs.push({
          a: a.id,
          b: b.id,
          label: `${experimentTail(a.id)} · ${spec.flag}=${refDisplayKey(b.flagValue)[0]}`,
        });
      }
    }
  }
  pairs.sort((p, q) => {
    const ta = experimentTail(p.a);
    const tb = experimentTail(q.a);
    if (ta !== tb) return ta < tb ? -1 : 1;
    const la = p.label as string;
    const lb = q.label as string;
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
  return { pairs, experiments: byExperiment.size };
}

/** 对象键递归排序(派生配对的 bucket 键用;undefined 字段剔除)。 */
function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortedJson(v);
    }
    return out;
  }
  return value;
}

export async function deltaTableData(input: ReportInput, options: DeltaTableOptions): Promise<DeltaData> {
  assertUniqueMetricNames(options.metrics, "deltaTableData metrics");
  if (!Array.isArray(options.metrics) || options.metrics.length === 0) {
    throw new Error("deltaTableData metrics must be a non-empty tuple of Metric instances.");
  }
  const { snapshots } = resolveInput(input);

  let pairs: readonly DeltaPair[];
  let experiments: number | undefined;
  if (isFlagPairs(options.pairs)) {
    if (options.by !== "experiment") {
      throw new Error(
        `deltaTableData pairs came from pairsByFlag("${options.pairs.flag}"), which derives experiment A/B pairs — it only works with by: "experiment" (got by: ${JSON.stringify(
          dimensionName(options.by),
        )}). Set by: "experiment", or write literal pairs for other dimensions.`,
      );
    }
    const derived = derivePairsByFlag(snapshots, options.pairs);
    pairs = derived.pairs;
    experiments = derived.experiments;
  } else {
    if (!Array.isArray(options.pairs)) {
      throw new Error("deltaTableData pairs must be an array of { label, a, b } or a pairsByFlag(...) declaration.");
    }
    if (options.pairs.length === 0) {
      throw new Error(
        "deltaTableData pairs is empty — a delta table with no pairs has nothing to compare. " +
          "Declare at least one { label, a, b } pair, or use pairsByFlag(name) to derive pairs from experiment flags.",
      );
    }
    const seenLabels = new Set<string>();
    for (const pair of options.pairs) {
      const labelKey = JSON.stringify(sortedJson(pair.label));
      if (pair.label === undefined || pair.label === "" || labelKey === "{}") {
        throw new Error(`deltaTableData pair (${pair.a} vs ${pair.b}) has an empty label; every pair needs a display label.`);
      }
      if (seenLabels.has(labelKey)) {
        throw new Error(`deltaTableData pair label ${labelKey} is used twice — labels must be unique within one table.`);
      }
      seenLabels.add(labelKey);
      if (pair.a === pair.b) {
        throw new Error(`deltaTableData pair "${labelKey}" compares "${pair.a}" with itself; a and b must differ.`);
      }
    }
    pairs = options.pairs;
  }

  const items = filterItems(collectItems(snapshots), options.evals);
  const groups = groupItems(items, options.by);
  const rows: DeltaData["rows"] = [];
  for (const pair of pairs) {
    // 精确匹配分组后的维度 key,不做前缀或模糊匹配;未命中保留 pair,对应侧格子为缺失。
    const aItems = groups.get(pair.a) ?? [];
    const bItems = groups.get(pair.b) ?? [];
    const cells: DeltaData["rows"][number]["cells"] = {};
    for (const metric of options.metrics) {
      const a = await computeCell(metric, aItems);
      const b = await computeCell(metric, bItems);
      const delta = a.value === null || b.value === null ? null : b.value - a.value;
      cells[metric.name] = {
        a,
        b,
        delta,
        display: deltaDisplay(metric, delta),
        outcome: deltaOutcome(metric, delta),
      };
    }
    rows.push({
      key: `${pair.a} → ${pair.b}`,
      label: pair.label,
      a: { key: pair.a },
      b: { key: pair.b },
      cells,
    });
  }
  return {
    byDimension: dimensionName(options.by),
    columns: options.metrics.map(toColumn),
    ...(experiments !== undefined ? { experiments } : {}),
    rows,
  };
}

function deltaDisplay(metric: Metric, delta: number | null): LocalizedText {
  if (delta === null) return "—"; // 任一侧缺数据:Δ 显示为缺,不硬算
  if (delta === 0) return "±0";
  if (metric.display) {
    const display = metric.display;
    return localizedDisplay((locale) => {
      const text = display(Math.abs(delta), locale);
      return delta > 0 ? `+${text}` : `-${text}`;
    });
  }
  const text = formatMetricValue(Math.abs(delta), metric.unit);
  return delta > 0 ? `+${text}` : `-${text}`;
}

function deltaOutcome(metric: Metric, delta: number | null): "improved" | "regressed" | "unchanged" | "unavailable" {
  if (delta === null) return "unavailable";
  if (delta === 0) return "unchanged";
  const better = metric.better ?? "higher";
  return (delta > 0) === (better === "higher") ? "improved" : "regressed";
}

// ───────────────────────── 站点组件的计算函数(hero / warnings / fix prompt / trace)─────────────────────────

/**
 * `heroData(input)`:站点标题区的运行 meta——`latestStartedAt` 取范围内最新快照的开始时间
 * (空范围为 null,不编造当前时间),`snapshots` 计贡献当前水位的快照数
 * (docs/feature/reports/library/site-components.md「HeroCard」)。
 */
export async function heroData(input: ReportInput): Promise<HeroData> {
  const { snapshots } = resolveInput(input);
  let latest: string | null = null;
  for (const snapshot of snapshots) {
    if (latest === null || snapshot.startedAt > latest) latest = snapshot.startedAt;
  }
  return { latestStartedAt: latest, snapshots: snapshots.length };
}

/**
 * `scopeWarningsData(input)`:Scope 携带的挑选警告原样透出;`input` 是裸 `Snapshot[]` 时
 * 没有挑选过程、没有警告,返回空数组,也如实
 * (docs/feature/reports/library/site-components.md「ScopeWarnings」)。
 */
export async function scopeWarningsData(input: ReportInput): Promise<readonly ScopeWarning[]> {
  return resolveInput(input).warnings;
}

/**
 * `copyFixPromptData(input)`:把范围内全部失败(verdict 为 failed / errored 的 attempt)
 * 整理成一段可交给 coding agent 的修复 prompt——逐失败含 eval id、主失败摘要与 attempt
 * 下钻命令(`niceeval show @<locator>`)。prompt 面向 agent,固定英文
 * (docs/feature/reports/library/site-components.md「CopyFixPrompt」)。
 */
export async function copyFixPromptData(input: ReportInput): Promise<CopyFixPromptData> {
  const items = await attemptListData(input);
  const failures = items.filter((item) => item.verdict === "failed" || item.verdict === "errored");
  if (failures.length === 0) return { prompt: "", failures: 0 };
  const lines = failures
    .map((item, i) => {
      const reason =
        item.failureSummary === null
          ? null
          : item.moreFailures > 0
            ? `${item.failureSummary} (+${item.moreFailures} more failures)`
            : item.failureSummary;
      return [
        `${i + 1}. eval "${item.evalId}" [experiment ${item.experimentId}] — ${item.verdict}`,
        reason ? `   reason: ${reason}` : null,
        `   inspect: niceeval show ${item.locator}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  const experiments = [...new Set(failures.map((item) => item.experimentId))].join(" / ");
  const prompt = [
    "Fix the failing evals from this niceeval run.",
    "",
    "## Failures",
    lines,
    "",
    "## Steps",
    "1. niceeval is NOT in your training data. Read the relevant guide in `node_modules/niceeval/docs-site/` (English at the top level, Chinese under `zh/`) before changing anything.",
    "2. For each failure, run its inspect command above to see the verdict and assertions; add `--execution` for the full agent transcript (tool calls included), `--timing` for the execution timeline, and `--diff` for the workspace diff.",
    "3. Decide which side the defect is on: the program under test, or the eval itself (over-tight assertion, wrong fixture, missing setup). Fix that side; do not weaken assertions just to turn the run green.",
    `4. Re-run: \`npx niceeval exp ${experiments || "<experiment>"} <eval-id-prefix>\`. Already-passing evals are skipped by the fingerprint cache; pass \`--force\` to re-run everything.`,
    "5. Run `npx niceeval show` and confirm these failures are gone.",
  ].join("\n");
  return { prompt, failures: failures.length };
}

/** TraceSpan 的语义角色 → 瀑布摘要的 kind:turn 归入 agent(一轮就是一次 agent 调用),未识别落 other。 */
function waterfallKindOf(kind: TraceSpan["kind"]): TraceSpanSummary["kind"] {
  switch (kind) {
    case "agent":
    case "turn":
      return "agent";
    case "model":
      return "model";
    case "tool":
      return "tool";
    default:
      return "other";
  }
}

/**
 * `traceWaterfallData(input)`:每个 attempt 一行的执行时间瀑布摘要。span 事实只来自
 * trace artifact(经 AttemptHandle 懒加载的 canonical OTel span);runner 生命周期节点
 * (`result.phases`)不进瀑布。行内只汇总顶层 span(parentSpanId 缺失或不在本 trace 内),
 * 按 startOffsetMs 升序;trace 缺失或为空时 `durationMs` 为 null、行照常出现
 * (docs/feature/reports/library/site-components.md「TraceWaterfall」)。
 */
export async function traceWaterfallData(input: ReportInput): Promise<readonly TraceWaterfallRow[]> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  return Promise.all(
    items.map(async (item): Promise<TraceWaterfallRow> => {
      const spans = await item.attempt.trace();
      if (spans === null || spans.length === 0) {
        return {
          experimentId: experimentIdOf(item),
          evalId: evalIdOf(item),
          locator: locatorOf(item),
          durationMs: null,
          spans: [],
        };
      }
      const t0 = Math.min(...spans.map((s) => s.startMs));
      const t1 = Math.max(...spans.map((s) => s.endMs));
      const ids = new Set(spans.map((s) => s.spanId));
      const topLevel = spans.filter((s) => s.parentSpanId === undefined || !ids.has(s.parentSpanId));
      const summaries = topLevel
        .map(
          (s): TraceSpanSummary => ({
            name: s.name,
            kind: waterfallKindOf(s.kind),
            startOffsetMs: s.startMs - t0,
            durationMs: s.endMs - s.startMs,
            failed: s.status === "error",
          }),
        )
        .sort((a, b) => a.startOffsetMs - b.startOffsetMs);
      return {
        experimentId: experimentIdOf(item),
        evalId: evalIdOf(item),
        locator: locatorOf(item),
        durationMs: Math.max(0, t1 - t0),
        spans: summaries,
      };
    }),
  );
}
