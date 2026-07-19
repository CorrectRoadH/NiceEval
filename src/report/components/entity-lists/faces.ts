// 实体列表族(ExperimentList / EvalList / AttemptList)的 text 面:同一份算好的数据,
// 渲染成终端字符(niceeval show 的形态)。三面共用的紧凑标记:`locator✓`(判定符紧跟
// locator,中间不留空格)。ExperimentList / EvalList 逐 attempt 只列这一个标记 + 各自的
// 摘要,不重复整段 niceeval show 命令;要看某个 attempt 的完整证据,agent 自己拼
// `niceeval show <locator>`。零 react、零 IO、纯同步。

import type { AttemptListItem, EvalListItem, ExperimentListItem } from "../../model/types.ts";
import type { TextContext } from "../../definition/tree.ts";
import type { TableColumn, TableRow } from "../../definition/primitives.tsx";
import {
  experimentDisplayName,
  fitFailureSummary,
  formatDurationMs,
  formatUSD,
  verdictMark,
} from "../../model/format.ts";
import { countText, localeText, type ReportLocale } from "../../model/locale.ts";
import { stringWidth, wrapDisplay } from "../../model/text-layout.ts";
import { renderTableText } from "../../definition/table-text.ts";
import { cellText, missingText, verdictTallyText, MISSING_MARK } from "../shared-faces.ts";

// ───────────────────────── 实体列表(ExperimentList / EvalList / AttemptList)─────────────────────────
//
// 三面共用的紧凑标记:`locator✓`(判定符紧跟 locator,中间不留空格)。
// ExperimentList / EvalList 逐 attempt 只列这一个标记 + 各自的摘要,不重复整段
// niceeval show 命令;要看某个 attempt 的完整证据,agent 自己拼 `niceeval show <locator>`。

function locatorBadge(item: { locator: string; verdict: AttemptListItem["verdict"] }): string {
  return `${item.locator}${verdictMark(item.verdict)}`;
}

/**
 * failureSummary + moreFailures 的展示形态:摘要在计算侧已按 Scoring display 契约折好,
 * 这里只加 "+N more failures" 计数与宽度收口,不重算摘要。
 */
function attemptReasonText(item: AttemptListItem, locale: ReportLocale, maxChars: number): string | undefined {
  if (item.failureSummary === null) return undefined;
  const withMore =
    item.moreFailures > 0
      ? `${item.failureSummary} · ${countText(locale, "entityList.moreFailures", item.moreFailures)}`
      : item.failureSummary;
  return fitFailureSummary(withMore, Math.max(24, maxChars));
}

// ── ExperimentList ──

function experimentSummaryTable(
  items: readonly ExperimentListItem[],
  ctx: TextContext,
  relativeTo?: string,
): string {
  const locale = ctx.locale;
  const compact = ctx.width < 100;
  const columns: TableColumn[] = [
    { key: "experiment", header: compact && locale === "en" ? "Exp." : localeText(locale, "experimentList.experiment") },
    { key: "model", header: localeText(locale, "table.model") },
    { key: "agent", header: localeText(locale, "table.agent") },
    { key: "duration", header: compact && locale === "en" ? "Avg" : localeText(locale, "experimentList.avgDuration"), align: "right" },
    { key: "passRate", header: compact && locale === "en" ? "Pass" : localeText(locale, "experimentList.passRate"), align: "right" },
    { key: "result", header: localeText(locale, "experimentList.result") },
    { key: "tokens", header: localeText(locale, "experimentList.tokens"), align: "right" },
    { key: "cost", header: localeText(locale, "experimentList.cost"), align: "right" },
  ];
  const rows: TableRow[] = items.map((item) => ({
    key: item.experimentId,
    cells: {
      experiment: experimentDisplayName(item.experimentId, relativeTo),
      model: item.model ?? localeText(locale, "experimentList.defaultModel"),
      agent: item.agent,
      duration: cellText(item.durationMs, locale),
      passRate: cellText(item.endToEndPassRate, locale),
      result: verdictTallyText(item.evalVerdicts, locale),
      tokens: cellText(item.tokens, locale),
      cost: cellText(item.costUSD, locale),
    },
  }));
  const metadata = items.flatMap((item) =>
    wrapDisplay(
      `${experimentDisplayName(item.experimentId, relativeTo)}: ${localeText(locale, "overview.evalsCount", { n: item.evals })} · ${localeText(locale, "overview.attemptsCount", { n: item.attempts })} · ${item.lastRunAt}`,
      Math.max(8, ctx.width - 2),
    ).map((line) => `  ${line}`),
  );
  return [renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx), metadata.join("\n")].join("\n");
}

function experimentDetailTable(item: ExperimentListItem, ctx: TextContext, relativeTo?: string): string {
  const locale = ctx.locale;
  const columns: TableColumn[] = [
    { key: "status", header: localeText(locale, "experimentList.status") },
    { key: "entity", header: localeText(locale, "experimentList.evalAttempt") },
    // Result 是可扫读的失败预览,不是证据面:两行放不下的以 … 收口,完整值走 locator 下钻。
    { key: "result", header: localeText(locale, "experimentList.result"), maxLines: 2 },
    { key: "duration", header: localeText(locale, "experimentList.duration"), align: "right" },
    { key: "cost", header: localeText(locale, "experimentList.cost"), align: "right" },
  ];
  // Result 的字符预算 ≈ 两行 × 它能分到的列宽(总宽减其它列的自然宽与列距)。这里只做
  // 粗预算;精确的按宽度收口由列的 maxLines 兜底。
  const statusWidth = Math.max(
    stringWidth(localeText(locale, "experimentList.status")),
    ...item.evalRows.map((row) => stringWidth(`${verdictMark(row.verdict)} ${localeText(locale, `verdict.${row.verdict}`)}`)),
  );
  const entityWidth = Math.max(
    stringWidth(localeText(locale, "experimentList.evalAttempt")),
    ...item.evalRows.flatMap((row) => [stringWidth(row.evalId), ...row.attempts.map((a) => stringWidth(a.locator) + 3)]),
  );
  const fixedWidth = statusWidth + entityWidth + 8 /* duration */ + 6 /* cost */ + 3 * 4; /* 4 段列距 */
  const resultBudget = Math.max(24, (ctx.width - fixedWidth) * 2);
  const rows: TableRow[] = item.evalRows.flatMap((row) => {
    // Eval 父行只承载折叠判定与题级聚合;失败摘要只在 Attempt 子行出现。
    const parent: TableRow = {
      key: row.evalId,
      cells: {
        status: `${verdictMark(row.verdict)} ${localeText(locale, `verdict.${row.verdict}`)}`,
        entity: row.evalId,
        result: "",
        duration: localeText(locale, "entityList.average", { value: cellText(row.durationMs, locale) }),
        cost: localeText(locale, "entityList.average", { value: cellText(row.costUSD, locale) }),
      },
    };
    const attempts: TableRow[] = row.attempts.map((attempt, index) => ({
      key: attempt.locator,
      cells: {
        status: `  ${verdictMark(attempt.verdict)}`,
        entity: `${index === row.attempts.length - 1 ? "└─" : "├─"} ${attempt.locator}`,
        result: attemptReasonText(attempt, locale, resultBudget) ?? MISSING_MARK,
        duration: attempt.verdict === "skipped" && attempt.durationMs === 0 ? null : formatDurationMs(attempt.durationMs),
        cost: attempt.costUSD === null ? null : formatUSD(attempt.costUSD),
      },
    }));
    return [parent, ...attempts];
  });
  const flags = item.flags && Object.keys(item.flags).length > 0
    ? `${localeText(locale, "experimentList.flags")} ${Object.entries(item.flags)
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" · ")}`
    : undefined;
  return [
    experimentDisplayName(item.experimentId, relativeTo),
    flags,
    renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx),
  ]
    .filter(Boolean)
    .join("\n");
}

export function experimentListText(items: readonly ExperimentListItem[], ctx: TextContext, relativeTo?: string): string {
  if (items.length === 0) return localeText(ctx.locale, "attemptList.empty");
  return [
    experimentSummaryTable(items, ctx, relativeTo),
    ...items.map((item) => experimentDetailTable(item, ctx, relativeTo)),
  ].join("\n\n");
}

// ── EvalList ──

function evalListAttemptLine(item: AttemptListItem, ctx: TextContext): string {
  // 行式列表同守「Result 最多两行」:预算 = 两行终端宽,超出按尾截收口。
  const reason = attemptReasonText(item, ctx.locale, ctx.width * 2 - stringWidth(locatorBadge(item)) - 6);
  return `  ${locatorBadge(item)}${reason ? ` · ${reason}` : ""}`;
}

export function evalListText(items: readonly EvalListItem[], ctx: TextContext): string {
  const locale = ctx.locale;
  if (items.length === 0) return localeText(locale, "attemptList.empty");
  const blocks = items.map((item) => {
    const identity = `${item.evalId} · ${item.experimentId} · ${localeText(locale, `verdict.${item.verdict}`)}`;
    const summary = [
      localeText(locale, "attemptList.score", { score: cellText(item.examScore, locale) }),
      localeText(locale, "overview.attemptsCount", { n: item.attempts.length }),
      localeText(locale, "entityList.average", {
        value: item.durationMs.value === null ? missingText(locale) : formatDurationMs(item.durationMs.value),
      }),
      localeText(locale, "entityList.average", {
        value: item.costUSD.value === null ? missingText(locale) : formatUSD(item.costUSD.value),
      }),
    ].join(" · ");
    const attemptLines = item.attempts.map((attempt) => evalListAttemptLine(attempt, ctx));
    return [identity, `  ${summary}`, ...attemptLines].join("\n");
  });
  return blocks.join("\n\n");
}

// ── AttemptList ──

/** Attempt 比较卡片:只显示一条主失败摘要(至多两行终端宽);完整 assertions 走 locator 下钻。 */
function attemptListItemText(item: AttemptListItem, ctx: TextContext): string {
  const head = [
    `${verdictMark(item.verdict)} ${item.locator}`,
    item.evalId,
    item.experimentId,
    formatDurationMs(item.durationMs),
    ...(item.costUSD !== null ? [formatUSD(item.costUSD)] : []),
  ].join(" · ");
  const lines = [head];
  const reason = attemptReasonText(item, ctx.locale, ctx.width * 2 - 4);
  if (reason) lines.push(`  ${reason}`);
  return lines.join("\n");
}

export function attemptListText(items: readonly AttemptListItem[], total: number | undefined, ctx: TextContext): string {
  const locale = ctx.locale;
  if (items.length === 0) return localeText(locale, "attemptList.empty");
  const blocks = items.map((item) => attemptListItemText(item, ctx));
  const remaining = (total ?? items.length) - items.length;
  if (remaining > 0) blocks.push(localeText(locale, "attemptList.truncatedText", { n: remaining }));
  return blocks.join("\n\n");
}
