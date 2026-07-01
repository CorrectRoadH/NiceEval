// 判决:把执行结果 + 断言 + 跳过原因折叠成一个 Outcome(见 docs/scoring.md)。

import type { AssertionResult, ResultOutcome } from "../types.ts";

export function computeOutcome(input: {
  error?: string;
  assertions: readonly AssertionResult[];
  skipReason?: string;
  strict?: boolean;
}): ResultOutcome {
  if (input.error !== undefined) return "errored";

  for (const a of input.assertions) {
    if (a.passed) continue;
    if (a.severity === "gate" || input.strict) return "failed";
  }

  if (input.skipReason !== undefined) return "skipped";
  return "passed";
}
