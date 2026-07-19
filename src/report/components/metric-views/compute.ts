// 计算函数(*Data):ReportInput → 一份组件数据。跑在 Node 侧,产物是算好的、可序列化的
// 普通 JSON(终值 + 渲染提示,不含公式);渲染面(web/text)只做展示。指标图形族
// (MetricTable / MetricMatrix / MetricBars / Scoreboard / MetricScatter / MetricLine /
// DeltaTable)的 *Data 与配套 Options 都住在这里(docs/feature/reports/library/metric-views.md)。
//
// 共同约定(docs/feature/reports/architecture.md「指标聚合不变量」):
// - 第一参收 ReportInput = Scope | readonly Snapshot[];warnings 不进组件数据(宿主统一显示);
// - 聚合前按身份键去重(dedupeAttempts;missing-startedAt 不去重、如实保留、不透出警告);
// - null ≠ 0:缺数据不编数,覆盖率经 samples/total 如实暴露;
// - 显式传入的列表(questions / pairs / metrics)保留声明顺序,从数据发现的维度 domain
//   按稳定 key 字典序;
// - core 中立:只认 Metric / Dimension 接口,不出现具体 agent 名的分支。

import type {
  DeltaData,
  DeltaPair,
  DimensionInput,
  FlagPairs,
  LineData,
  MatrixData,
  Metric,
  MetricCell,
  NumericAxis,
  ReportInput,
  ScatterData,
  ScoreboardData,
  SeriesInput,
  TableData,
} from "../../model/types.ts";
import type { JsonValue } from "../../../types.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import type { Snapshot } from "../../../results/types.ts";
import { comparabilityConfigOf, deepEqualJson } from "../../../results/select.ts";
import { experimentGroupOf } from "../../../shared/aggregate.ts";
import {
  assertUniqueMetricNames,
  axisValueOf,
  collectItems,
  computeCell,
  dimensionKey,
  dimensionName,
  evalGroupOf,
  evalIdOf,
  experimentIdOf,
  filterItems,
  fullEvalKey,
  groupItems,
  locatorOf,
  refDisplayKey,
  resolveInput,
  seriesKey,
  seriesName,
  toColumn,
  type Item,
} from "../../model/aggregate.ts";
import { examScore } from "../../model/metrics.ts";
import { formatMetricValue, formatPlainNumber, localizedDisplay } from "../../model/format.ts";
import type { LocalizedText } from "../../model/locale.ts";
import { selectedEvalsOnly } from "../shared-compute.ts";

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

export interface MetricScatterOptions {
  /** 点维度:每个点 = 该组 attempt 的聚合。 */
  points: DimensionInput;
  /** 决定颜色和图例归类,默认不连线(连线是呈现 prop `connect`);数组形态解析为复合维度。 */
  series?: SeriesInput;
  x: Metric;
  y: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

export async function metricScatterData(input: ReportInput, options: MetricScatterOptions): Promise<ScatterData> {
  const snapshots = selectedEvalsOnly(resolveInput(input).snapshots);
  const items = filterItems(collectItems(snapshots), options.evals);
  const groups = groupItems(items, options.points);
  const rows: ScatterData["rows"] = [];
  for (const [key, group] of groups) {
    rows.push({
      key,
      // 组内取第一条解析系列:点维度细于系列维度时(experiment ⊂ agent)天然一致
      ...(options.series ? { series: seriesKey(options.series, group[0]!) } : {}),
      x: await computeCell(options.x, group),
      y: await computeCell(options.y, group), // 任一轴 null 的点留在 rows 里:组件不画,但注脚要报的数就从这里数
    });
  }
  return {
    pointDimension: dimensionName(options.points),
    ...(options.series ? { seriesDimension: seriesName(options.series) } : {}),
    x: toColumn(options.x),
    y: toColumn(options.y),
    rows,
  };
}

export interface MetricLineOptions {
  /** x 轴:NumericAxis(numericFlag() / numericLabel() / numericRunConfig() 或自定义 of),不解析 experiment 命名。 */
  x: NumericAxis;
  /** 数组形态解析为复合维度。 */
  series?: SeriesInput;
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
    const series = options.series ? seriesKey(options.series, item) : undefined;
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
    ...(options.series ? { seriesDimension: seriesName(options.series) } : {}),
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
