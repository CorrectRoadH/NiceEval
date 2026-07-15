// scoring 结果的摘要投影。这里仅决定「摘要面显示哪一条、显示哪些事实」；完整诊断面继续
// 消费 AssertionResult[]，不复用这个有损投影。

import type { AssertionResult, PrimaryAssertionSummary, Verdict } from "./types.ts";

/**
 * Human/Agent 摘要是一条终端事实行，不是完整证据面。压成单行并设字符上限，避免 received
 * 恰好是源码/工具输出时把多页内容灌进 scrollback；完整 AssertionResult 仍原样留给 show/view。
 */
const SUMMARY_TEXT_MAX_CHARS = 240;

/** 摘要面的单值收口:折单行 + 240 字符上限。任何把断言事实放进「行」里的面共用这一条。 */
export function summaryText(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length <= SUMMARY_TEXT_MAX_CHARS
    ? singleLine
    : `${singleLine.slice(0, SUMMARY_TEXT_MAX_CHARS - 1)}…`;
}

/**
 * 按公开展示契约选择主失败断言：failed gate 优先；只有 soft 促成 failed verdict 时才取 soft；
 * errored 且没有结构化 error 时可由第一条非 optional unavailable 解释。
 */
export function primaryAssertionSummary(
  assertions: readonly AssertionResult[],
  verdict: Verdict,
): PrimaryAssertionSummary | undefined {
  if (verdict === "failed") {
    const failedGates = assertions.filter(
      (assertion) => assertion.outcome === "failed" && assertion.severity === "gate",
    );
    if (failedGates.length > 0) return summaryOf(failedGates[0]!, failedGates.length - 1);

    const failedSoft = assertions.filter(
      (assertion) => assertion.outcome === "failed" && assertion.severity === "soft",
    );
    if (failedSoft.length > 0) return summaryOf(failedSoft[0]!, failedSoft.length - 1);
  }

  if (verdict === "errored") {
    const unavailable = assertions.filter(
      (assertion) => assertion.outcome === "unavailable" && assertion.optional !== true,
    );
    if (unavailable.length > 0) return summaryOf(unavailable[0]!, unavailable.length - 1);
  }

  return undefined;
}

function summaryOf(assertion: AssertionResult, additionalFailures: number): PrimaryAssertionSummary {
  const rawTitle = assertion.groupPath?.length ? assertion.groupPath.join(" > ") : assertion.name;
  const rawMatcher = assertion.detail ?? assertion.name;
  const title = summaryText(rawTitle);
  return {
    severity: assertion.severity,
    assertion: title,
    ...(rawMatcher !== rawTitle ? { matcher: summaryText(rawMatcher) } : {}),
    ...(assertion.outcome === "unavailable"
      ? { reason: summaryText(assertion.reason) }
      : {
          ...(assertion.expected !== undefined ? { expected: summaryText(assertion.expected) } : {}),
          ...(assertion.received !== undefined ? { received: summaryText(assertion.received) } : {}),
          ...(assertion.severity === "soft" || assertion.threshold !== undefined ? { score: assertion.score } : {}),
          ...(assertion.threshold !== undefined ? { threshold: assertion.threshold } : {}),
        }),
    additionalFailures,
  };
}

/** 摘要的事实层；Human/Agent 用作第二行，表格可把它接在标题后。 */
export function assertionSummaryDetail(summary: PrimaryAssertionSummary): string | undefined {
  const parts: string[] = [];
  if (summary.matcher !== undefined) parts.push(summary.matcher);
  if (summary.expected !== undefined) parts.push(`expected ${summary.expected}`);
  if (summary.received !== undefined) parts.push(`received ${summary.received}`);
  if (summary.score !== undefined) parts.push(`score ${summary.score}`);
  if (summary.threshold !== undefined) parts.push(`threshold ${summary.threshold}`);
  if (summary.reason !== undefined) parts.push(`reason ${summary.reason}`);
  if (summary.additionalFailures > 0) parts.push(`+${summary.additionalFailures} more failures`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Human/Agent 的至多两层文本。 */
export function assertionSummaryLines(summary: PrimaryAssertionSummary): [string] | [string, string] {
  const head = `${summary.severity}: ${summary.assertion}`;
  const detail = assertionSummaryDetail(summary);
  return detail === undefined ? [head] : [head, detail];
}

/** 比较列表的单元格投影；无 group 时不重复 `gate:` 前缀。 */
export function compactAssertionSummary(summary: PrimaryAssertionSummary): string {
  const hasDistinctTitle = summary.matcher !== undefined;
  const head = hasDistinctTitle ? `${summary.severity}: ${summary.assertion}` : summary.assertion;
  const detail = assertionSummaryDetail(summary);
  return detail === undefined ? head : `${head} · ${detail}`;
}

/** 收口用的截断:目标长度容不下时截到 target-1 并补 `…`。 */
function shrinkTo(text: string, target: number): string {
  return text.length <= target ? text : `${text.slice(0, Math.max(0, target - 1))}…`;
}

/**
 * 单元格投影的宽度收口。空间不足时按解释力从低到高让位:先截语义标题、再截 matcher,
 * `expected / received` 与 `+N more failures` 最后截——它们直接解释为什么红。
 * maxChars 由渲染面按可用宽度给(如两行单元格 = 2 × 列宽);字符数口径与
 * SUMMARY_TEXT_MAX_CHARS 一致,显示宽度的精确裁剪仍归渲染面。
 */
export function fitCompactAssertionSummary(summary: PrimaryAssertionSummary, maxChars: number): string {
  const budget = Math.max(24, Math.floor(maxChars));
  let full = compactAssertionSummary(summary);
  if (full.length <= budget) return full;

  const TITLE_FLOOR = 24;
  let fitted: PrimaryAssertionSummary = {
    ...summary,
    assertion: shrinkTo(summary.assertion, Math.max(TITLE_FLOOR, summary.assertion.length - (full.length - budget))),
  };
  full = compactAssertionSummary(fitted);
  if (full.length <= budget) return full;

  const MATCHER_FLOOR = 16;
  if (fitted.matcher !== undefined) {
    fitted = {
      ...fitted,
      matcher: shrinkTo(fitted.matcher, Math.max(MATCHER_FLOOR, fitted.matcher.length - (full.length - budget))),
    };
    full = compactAssertionSummary(fitted);
    if (full.length <= budget) return full;
  }

  return shrinkTo(full, budget);
}
