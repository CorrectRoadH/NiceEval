// 官方组件的 text 面:同一份算好的数据,渲染成终端字符(niceeval show 的形态)。
// 输出形态照 docs-site/zh/guides/report-components.mdx 的示例块;与 web 面共守
// 诚实契约:排序随 better、samples < total 角标、缺数据 — 不补 0、截断报剩余。
// 零 react、零 IO、纯同步 —— 这是 text 宿主不需要 react-dom 的那一半。
// chrome 文案(注脚、verdict 词、截断提示)经 ctx.locale 查 locale 字典,
// 默认 en 与历史输出逐字一致;数据(display、键、warnings message)不本地化。

import type {
  CaseListData,
  DeltaData,
  ExperimentTableData,
  GroupSummaryData,
  LineData,
  MatrixData,
  MetricColumn,
  OverviewData,
  ScatterData,
  ScoreboardData,
  TableData,
} from "../types.ts";
import type { TextContext } from "../tree.ts";
import { formatDurationMs, formatMetricValue, formatPlainNumber, formatUSD } from "../format.ts";
import { countText, localeText, resolveMetricLabel, type ReportLocale } from "../locale.ts";
import { indentBlock, padDisplay, renderAlignedRows, textBar, wrapDisplay } from "./layout.ts";
import { renderCharPlot, renderCoordinateTable, type PlotPoint } from "./plot.ts";

const MISSING_MARK = "—";

/** 缺数据文案随 locale(en = "no data",与 MISSING_TEXT 一致)。 */
function missingText(locale: ReportLocale): string {
  return localeText(locale, "cell.missing");
}

/** 格子的文本形态:缺数据 —,覆盖不全带 samples/total 角标。 */
export function cellText(cell: { value: number | null; display: string; samples: number; total: number }): string {
  if (cell.value === null) return MISSING_MARK;
  return cell.samples < cell.total ? `${cell.display} ${cell.samples}/${cell.total}` : cell.display;
}

// ───────────────────────── RunOverview ─────────────────────────

export function overviewText(data: OverviewData, ctx: TextContext): string {
  const { totals, snapshots } = data;
  const locale = ctx.locale;
  const runs = new Set(snapshots.map((s) => s.startedAt)).size;
  const latest = snapshots.map((s) => s.startedAt).sort().at(-1);
  const head = [
    countText(locale, "overview.experiments", snapshots.length),
    localeText(locale, "overview.evalsCount", { n: totals.evals }),
    localeText(locale, "overview.attemptsCount", { n: totals.attempts }),
    // 通过率只渲染 computeCell 算好的同一个 MetricCell(cellText 复用缺数据/coverage 角标语义),
    // 不从 passed/failed/errored 现场重算——与 web 面 RunOverview 同一份数据同一种读法。
    `${localeText(locale, "overview.passRate")} ${cellText(totals.passRate)}`,
    countText(locale, "composedFrom", runs),
    ...(latest ? [localeText(locale, "latestRun", { run: latest })] : []),
  ].join(" · ");
  const tallies = [
    `${localeText(locale, "verdict.passed")} ${totals.passed}`,
    `${localeText(locale, "verdict.failed")} ${totals.failed}`,
    `${localeText(locale, "verdict.errored")} ${totals.errored}`,
    `${localeText(locale, "verdict.skipped")} ${totals.skipped}`,
    totals.costUSD === null ? missingText(locale) : formatUSD(totals.costUSD),
    formatDurationMs(totals.durationMs),
  ].join(" · ");
  const lines = [head, tallies];
  for (const warning of data.warnings) lines.push(`! ${warning.message}`);
  return lines.join("\n");
}

// ───────────────────────── GroupSummary ─────────────────────────

/**
 * 一至两行:头行是通过率(GroupSummaryData.passRate.display,不重算比例)+ experiment/eval 数 +
 * failed(+ errored,非零才列,与旧 GroupSelector 卡片一致)+ 总成本;第二行(有则加)是最后运行时间。
 * 不依赖固定网格宽度,窄终端自然换行。
 */
export function groupSummaryText(data: GroupSummaryData, ctx: TextContext): string {
  const locale = ctx.locale;
  const head = [
    `${localeText(locale, "overview.passRate")} ${cellText(data.passRate)}`,
    countText(locale, "overview.experiments", data.experiments),
    localeText(locale, "overview.evalsCount", { n: data.evals }),
    `${localeText(locale, "verdict.failed")} ${data.verdicts.failed}`,
    ...(data.verdicts.errored > 0 ? [`${localeText(locale, "verdict.errored")} ${data.verdicts.errored}`] : []),
    data.totalCostUSD === null ? missingText(locale) : formatUSD(data.totalCostUSD),
  ].join(" · ");
  const lines = [head];
  if (data.lastRunAt) lines.push(localeText(locale, "latestRun", { run: data.lastRunAt }));
  return lines.join("\n");
}

// ───────────────────────── ExperimentTable ─────────────────────────

/** 主榜完整列 + 每个 experiment 的失败/错误诊断；终端不模拟网页展开状态。 */
export function experimentTableText(data: ExperimentTableData, ctx: TextContext): string {
  const zh = ctx.locale === "zh-CN";
  const verdicts = (row: ExperimentTableData["rows"][number]) => {
    const words = zh ? { passed:"通过", failed:"失败", errored:"错误", skipped:"跳过" } : { passed:"passed", failed:"failed", errored:"errored", skipped:"skipped" };
    return (["passed","failed","errored","skipped"] as const).filter(k => row.summary.verdicts[k]).map(k => `${row.summary.verdicts[k]} ${words[k]}`).join(" / ") || MISSING_MARK;
  };
  const table = renderAlignedRows([
    zh ? ["实验","模型","Agent","平均耗时","成功率","Tokens","预估成本","结果"] : ["Experiment","Model","Agent","Avg duration","Pass rate","Tokens","Est. cost","Result"],
    ...data.rows.map(row => [row.label,row.model ?? MISSING_MARK,row.agent,cellText(row.summary.duration),cellText(row.summary.passRate),cellText(row.summary.tokens),cellText(row.summary.cost),verdicts(row)]),
  ]);
  const details = data.rows.flatMap(row => {
    const failing = row.evals.filter(e => e.verdict === "failed" || e.verdict === "errored");
    if (!failing.length) return [];
    const config = [`runs=${row.config.runs}`, ...(row.config.earlyExit === undefined ? [] : [`earlyExit=${row.config.earlyExit}`]), ...(row.config.sandbox ? [`sandbox=${row.config.sandbox}`] : []), ...(row.config.budget === undefined ? [] : [`budget=${formatUSD(row.config.budget)}`])].join(" · ");
    const lines = [`${row.experimentId} — ${config}`];
    for (const e of failing) {
      lines.push(`  ${e.verdict === "errored" ? "!" : "✗"} ${e.key}${e.runs > 1 ? ` (${e.passedRuns}/${e.runs})` : ""}${e.reason ? ` — ${e.reason}` : ""} · ${formatDurationMs(e.durationMs)} · ${formatPlainNumber(e.tokens)} tokens · ${e.totalCostUSD === null ? MISSING_MARK : formatUSD(e.totalCostUSD)}`);
      lines.push(`    → niceeval show ${e.key}`);
    }
    return [lines.join("\n")];
  });
  return [table, ...details].join("\n\n");
}

// ───────────────────────── MetricTable ─────────────────────────

/** verdict 计票的紧凑文案("3 passed / 1 failed"):非零判定逐个列,全部为零如实 —。 */
export function verdictTallyText(
  verdicts: NonNullable<NonNullable<TableData["rows"][number]["meta"]>["verdicts"]>,
  locale: ReportLocale,
): string {
  const parts: string[] = [];
  for (const kind of ["passed", "failed", "errored", "skipped"] as const) {
    if (verdicts[kind] > 0) parts.push(`${verdicts[kind]} ${localeText(locale, `verdict.${kind}`)}`);
  }
  return parts.length > 0 ? parts.join(" / ") : MISSING_MARK;
}

export function tableText(data: TableData, ctx: TextContext): string {
  const locale = ctx.locale;
  // meta 在场时补 Model / Agent / Verdicts 列(rows: "experiment" 的榜单 parity);
  // 列序对齐 view 原生榜单:experiment、model、agent、指标列…、verdicts
  const hasMeta = data.rows.some((row) => row.meta !== undefined);
  const hasModel = data.rows.some((row) => row.meta?.model !== undefined);
  const hasVerdicts = data.rows.some((row) => row.meta?.verdicts !== undefined);
  const header = [
    data.dimension,
    ...(hasMeta && hasModel ? [localeText(locale, "table.model")] : []),
    ...(hasMeta ? [localeText(locale, "table.agent")] : []),
    ...data.columns.map((c) => resolveMetricLabel(c.label, locale, c.key)),
    ...(hasVerdicts ? [localeText(locale, "table.verdicts")] : []),
  ];
  const rows = data.rows.map((row) => [
    row.key,
    ...(hasMeta && hasModel ? [row.meta?.model ?? MISSING_MARK] : []),
    ...(hasMeta ? [row.meta?.agent ?? MISSING_MARK] : []),
    ...data.columns.map((col) => {
      const cell = (row.cells as Record<string, TableData["rows"][number]["cells"][string]>)[col.key];
      return cell ? cellText(cell) : MISSING_MARK;
    }),
    ...(hasVerdicts ? [row.meta?.verdicts ? verdictTallyText(row.meta.verdicts, locale) : MISSING_MARK] : []),
  ]);
  const table = renderAlignedRows([header, ...rows]);

  // rows: "experiment" 专属的行摘要(eval/attempt 数 + 最后运行时间):表格列已经挤满
  // dimension/model/agent/指标/verdicts,这几个数字挤进行键下面单独一行,与 web 面
  // 「行键下的小 sub-line」同一份信息、同一种「不进列」的取舍。
  const metaLines: string[] = [];
  for (const row of data.rows) {
    if (row.meta?.evals === undefined) continue;
    const parts = [localeText(locale, "overview.evalsCount", { n: row.meta.evals })];
    if (row.meta.attempts !== undefined && row.meta.attempts > row.meta.evals) {
      parts.push(localeText(locale, "overview.attemptsCount", { n: row.meta.attempts }));
    }
    if (row.meta.lastRunAt) parts.push(localeText(locale, "latestRun", { run: row.meta.lastRunAt }));
    metaLines.push(`  ${row.key}: ${parts.join(" · ")}`);
  }

  // expand 展开的子行:表格本身只挤得下判定计票,原因得另起一块——每个有失败/错误子行
  // 的父行下面跟一段缩进明细(✗/! + 原因 + 下钻命令),没有 expand 或全通过的行不产出。
  const details: string[] = [];
  for (const row of data.rows) {
    const failing = (row.meta?.subRows ?? []).filter((sub) => sub.verdict === "failed" || sub.verdict === "errored");
    if (failing.length === 0) continue;
    const lines = [row.key];
    for (const sub of failing) {
      const mark = sub.verdict === "errored" ? "!" : "✗";
      const runs = sub.runs > 1 ? ` (${sub.passedRuns}/${sub.runs})` : "";
      const reason = sub.reason ? ` — ${sub.reason}` : "";
      lines.push(`  ${mark} ${sub.key}${runs}${reason}`);
      lines.push(`    → niceeval show ${sub.key}`);
    }
    details.push(indentBlock(lines.join("\n"), "  "));
  }
  const blocks = [
    table,
    ...(metaLines.length > 0 ? [metaLines.join("\n")] : []),
    ...(details.length > 0 ? [details.join("\n\n")] : []),
  ];
  return blocks.join("\n\n");
}

// ───────────────────────── MetricMatrix ─────────────────────────

export function matrixText(data: MatrixData): string {
  // 表体全是维度键与 display,没有 chrome 文案;"next:" 是命令提示,不本地化。
  const rowKeys: string[] = [];
  const columnKeys: string[] = [];
  const byPosition = new Map<string, MatrixData["cells"][number]["cell"]>();
  for (const entry of data.cells) {
    if (!rowKeys.includes(entry.row)) rowKeys.push(entry.row);
    if (!columnKeys.includes(entry.column)) columnKeys.push(entry.column);
    byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);
  }
  const header = [data.rows, ...columnKeys];
  const rows = rowKeys.map((row) => [
    row,
    ...columnKeys.map((column) => {
      const cell = byPosition.get(JSON.stringify([row, column]));
      return cell ? cellText(cell) : MISSING_MARK; // 稀疏格子在文本里以 — 呈现,不编数
    }),
  ]);
  const table = renderAlignedRows([header, ...rows]);

  // 下钻命令:行维度是 eval 时,指向最值得看的一行(先挑有缺格的,再挑按 better 最差的)
  if (data.rows !== "eval" || rowKeys.length === 0) return table;
  const better = data.metric.better ?? "higher";
  let next: string | undefined;
  let worst: { key: string; value: number } | undefined;
  for (const row of rowKeys) {
    let sum = 0;
    let count = 0;
    for (const column of columnKeys) {
      const cell = byPosition.get(JSON.stringify([row, column]));
      if (!cell || cell.value === null) {
        next ??= row;
        continue;
      }
      sum += cell.value;
      count += 1;
    }
    if (count > 0) {
      const value = sum / count;
      const isWorse = worst === undefined || (better === "higher" ? value < worst.value : value > worst.value);
      if (isWorse) worst = { key: row, value };
    }
  }
  next ??= worst?.key;
  return next === undefined ? table : `${table}\n\nnext: niceeval show ${next}`;
}

// ───────────────────────── MetricBars(矩阵数据的另一种摆法)─────────────────────────

const BAR_WIDTH = 20;

export function barsText(data: MatrixData): string {
  const groupKeys: string[] = [];
  const seriesKeys: string[] = [];
  const byPosition = new Map<string, MatrixData["cells"][number]["cell"]>();
  for (const entry of data.cells) {
    if (!groupKeys.includes(entry.row)) groupKeys.push(entry.row);
    if (!seriesKeys.includes(entry.column)) seriesKeys.push(entry.column);
    byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);
  }
  const better = data.metric.better ?? "higher";
  // 条长刻度:% 的天然域是 [0,1],其余以全图最大值为满条
  const values = data.cells.map((c) => c.cell.value).filter((v): v is number => v !== null);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  const ratioOf = (value: number) =>
    data.metric.unit === "%" ? value : maxValue === 0 ? 0 : value / maxValue;

  const seriesWidth = Math.max(...seriesKeys.map((k) => k.length), 0);
  const lines: string[] = [];
  for (const group of groupKeys) {
    lines.push(group);
    const entries = seriesKeys.map((series) => ({
      series,
      cell: byPosition.get(JSON.stringify([group, series])),
    }));
    // 组内按值排序,方向随 better(缺数据沉底)
    entries.sort((a, b) => {
      const va = a.cell?.value ?? null;
      const vb = b.cell?.value ?? null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return better === "lower" ? va - vb : vb - va;
    });
    for (const { series, cell } of entries) {
      const label = padDisplay(series, seriesWidth);
      if (!cell || cell.value === null) {
        lines.push(`  ${label}   ${MISSING_MARK}`);
        continue;
      }
      lines.push(`  ${label}   ${textBar(ratioOf(cell.value), BAR_WIDTH)}  ${cellText(cell)}`);
    }
  }
  return lines.join("\n");
}

// ───────────────────────── Scoreboard ─────────────────────────

export function scoreboardText(data: ScoreboardData, ctx: TextContext): string {
  const locale = ctx.locale;
  const subjectKeys: string[] = [];
  for (const row of data.rows) {
    for (const subject of row.subjects) {
      if (!subjectKeys.includes(subject.key)) subjectKeys.push(subject.key);
    }
  }
  const header = [data.dimension, localeText(locale, "scoreboard.totalText"), ...subjectKeys];
  const rows = data.rows.map((row) => [
    row.key,
    `${row.total.display}/${data.fullMarks}`,
    ...subjectKeys.map((key) => {
      const subject = row.subjects.find((s) => s.key === key);
      if (!subject) return MISSING_MARK;
      const score = `${formatPlainNumber(subject.earned)}/${formatPlainNumber(subject.possible)}`;
      return subject.missing > 0
        ? `${score} ${localeText(locale, "scoreboard.missingText", { n: subject.missing })}`
        : score;
    }),
  ]);
  const table = renderAlignedRows([header, ...rows]);
  if (data.weights.length === 0) return table;
  // 实际生效的权重表 —— 成绩单可审计
  const weights = data.weights.map((w) => `${w.prefix} ×${w.weight}`).join(" · ");
  return `${table}\n${localeText(locale, "scoreboard.weights")} ${weights} · ${localeText(locale, "scoreboard.othersWeight")}`;
}

// ───────────────────────── MetricScatter ─────────────────────────

const POINT_MARKS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function axisLabel(col: MetricColumn, locale: ReportLocale): string {
  return resolveMetricLabel(col.label, locale, col.key);
}

export function scatterText(data: ScatterData, ctx: TextContext): string {
  const locale = ctx.locale;
  const drawable = data.rows.filter((r) => r.x.value !== null && r.y.value !== null);
  const missing = data.rows.length - drawable.length;
  const footnotes: string[] = [];
  if (missing > 0) footnotes.push(countText(locale, "pointsMissing", missing));

  const axes = { x: axisLabel(data.x, locale), y: axisLabel(data.y, locale) };
  // 0 个可画点:x/y 指标没有可用数据(与 web 面同一事实)。
  if (drawable.length === 0) {
    return [localeText(locale, "scatter.noData", axes), ...footnotes].join("\n");
  }
  // 恰好 1 个可画点:成本 × 通过率的比较至少要两个实验,单点不成图。
  if (drawable.length === 1) {
    return [localeText(locale, "scatter.needTwo", axes), ...footnotes].join("\n");
  }

  // 点太密排不下时降级为坐标表,不硬挤
  if (drawable.length > POINT_MARKS.length || ctx.width < 44) {
    const table = renderCoordinateTable(
      drawable.map((r) => ({ key: r.key, x: r.x.display, y: r.y.display })),
      { key: data.points, x: axisLabel(data.x, locale), y: axisLabel(data.y, locale) },
    );
    return [table, ...footnotes].join("\n");
  }

  const points: PlotPoint[] = drawable.map((r, i) => ({
    mark: POINT_MARKS[i],
    x: r.x.value as number,
    y: r.y.value as number,
  }));
  // 同系列的点按 x 排序连线
  const bySeries = new Map<string, { x: number; y: number }[]>();
  for (const r of drawable) {
    if (r.series === undefined) continue;
    const list = bySeries.get(r.series) ?? [];
    list.push({ x: r.x.value as number, y: r.y.value as number });
    bySeries.set(r.series, list);
  }
  for (const list of bySeries.values()) list.sort((a, b) => a.x - b.x);

  const invertX = data.x.better === "lower";
  const plot = renderCharPlot({
    width: ctx.width,
    points,
    lines: [...bySeries.values()].filter((l) => l.length > 1),
    xLabel: `${axisLabel(data.x, locale)}${invertX ? ` ${localeText(locale, "scatter.axisReversed")}` : ""}`,
    yLabel: axisLabel(data.y, locale),
    formatX: (v) => formatMetricValue(v, data.x.unit),
    formatY: (v) => formatMetricValue(v, data.y.unit),
    invertX,
    invertY: data.y.better === "lower",
  });
  const legend = drawable.map((r, i) => `${POINT_MARKS[i]} ${r.key}`).join("   ");
  return [plot, "", localeText(locale, "scatter.betterUpperRight"), legend, ...footnotes].join("\n");
}

// ───────────────────────── MetricLine ─────────────────────────

export function lineText(data: LineData, ctx: TextContext): string {
  const locale = ctx.locale;
  const drawable = data.rows.filter((r) => r.x !== null && r.y.value !== null);
  const missing = data.rows.length - drawable.length;
  const footnotes: string[] = [];
  if (missing > 0) footnotes.push(countText(locale, "pointsMissing", missing));

  if (drawable.length === 0) return [missingText(locale), ...footnotes].join("\n");

  // 系列 → 字母;无系列 = 单系列
  const seriesKeys: string[] = [];
  for (const r of drawable) {
    const key = r.series ?? "";
    if (!seriesKeys.includes(key)) seriesKeys.push(key);
  }

  if (seriesKeys.length > POINT_MARKS.length || ctx.width < 44) {
    const table = renderCoordinateTable(
      drawable.map((r) => ({ key: r.series ? `${r.key} (${r.series})` : r.key, x: r.xDisplay, y: r.y.display })),
      { key: "experiment", x: data.x.label, y: axisLabel(data.y, locale) },
    );
    return [table, ...footnotes].join("\n");
  }

  const markOf = (r: LineData["rows"][number]) => POINT_MARKS[seriesKeys.indexOf(r.series ?? "")];
  const points: PlotPoint[] = drawable.map((r) => ({
    mark: markOf(r),
    x: r.x as number,
    y: r.y.value as number,
  }));
  const lines = seriesKeys.map((key) =>
    drawable
      .filter((r) => (r.series ?? "") === key)
      .map((r) => ({ x: r.x as number, y: r.y.value as number }))
      .sort((a, b) => a.x - b.x),
  );

  const plot = renderCharPlot({
    width: ctx.width,
    points,
    lines: lines.filter((l) => l.length > 1),
    xLabel: data.x.label,
    yLabel: axisLabel(data.y, locale),
    formatX: (v) => formatMetricValue(v, data.x.unit),
    formatY: (v) => formatMetricValue(v, data.y.unit),
    invertY: data.y.better === "lower",
  });
  const legend = seriesKeys
    .map((key, i) => `${POINT_MARKS[i]} ${key === "" ? axisLabel(data.y, locale) : key}`)
    .join("   ");
  return [plot, "", legend, ...footnotes].join("\n");
}

// ───────────────────────── DeltaTable ─────────────────────────

export function deltaText(data: DeltaData, ctx: TextContext): string {
  const header = ["pair", ...data.columns.map((c) => resolveMetricLabel(c.label, ctx.locale, c.key))];
  const rows = data.rows.map((row) => [
    row.key,
    ...data.columns.map((col) => {
      const cell = (row.cells as Record<string, DeltaData["rows"][number]["cells"][string]>)[col.key];
      if (!cell) return MISSING_MARK;
      const a = cell.a.value === null ? MISSING_MARK : cell.a.display;
      const b = cell.b.value === null ? MISSING_MARK : cell.b.display;
      return `${a} → ${b}   ${cell.display}`;
    }),
  ]);
  return renderAlignedRows([header, ...rows]);
}

// ───────────────────────── CaseList ─────────────────────────

export function caseListText(data: CaseListData, ctx: TextContext): string {
  const locale = ctx.locale;
  if (data.rows.length === 0) return localeText(locale, "caseList.empty");
  const lines: string[] = [];
  for (const row of data.rows) {
    const head = [
      `✗ ${row.eval}`,
      row.experimentId,
      localeText(locale, `verdict.${row.verdict}`),
      formatDurationMs(row.durationMs),
      ...(row.costUSD !== undefined ? [formatUSD(row.costUSD)] : []),
    ].join(" · ");
    lines.push(head);
    if (row.error) {
      lines.push(indentBlock(wrapDisplay(row.error, ctx.width - 4).join("\n"), "    "));
    }
    for (const assertion of row.failedAssertions) {
      const summary = assertion.detail
        ? `${assertion.name} — ${assertion.detail}`
        : `${assertion.name} — ${localeText(locale, "caseList.score", { score: assertion.score })}`;
      lines.push(indentBlock(wrapDisplay(summary, ctx.width - 4).join("\n"), "    "));
      if (assertion.evidence) {
        lines.push(indentBlock(wrapDisplay(assertion.evidence, ctx.width - 6).join("\n"), "      "));
      }
    }
    lines.push(`    → niceeval show ${row.eval}`);
  }
  if (data.truncated > 0) {
    lines.push("");
    lines.push(localeText(locale, "caseList.truncatedText", { n: data.truncated }));
  }
  return lines.join("\n");
}
