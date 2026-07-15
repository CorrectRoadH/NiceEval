// scoring 结果的摘要投影。这里仅决定「摘要面显示哪一条、显示哪些事实」；完整诊断面继续
// 消费 AssertionResult[]，不复用这个有损投影。

import type { AssertionResult, PrimaryAssertionSummary, Verdict } from "./types.ts";

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
  const title = assertion.groupPath?.length ? assertion.groupPath.join(" > ") : assertion.name;
  const matcher = assertion.detail ?? assertion.name;
  return {
    severity: assertion.severity,
    assertion: title,
    ...(matcher !== title ? { matcher } : {}),
    ...(assertion.outcome === "unavailable"
      ? { reason: assertion.reason }
      : {
          ...(assertion.expected !== undefined ? { expected: assertion.expected } : {}),
          ...(assertion.received !== undefined ? { received: assertion.received } : {}),
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
