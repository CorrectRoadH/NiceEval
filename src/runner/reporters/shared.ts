// verdict 符号表,当前唯一消费方是 src/runner/feedback/human.ts 的 dashboard/完成页。

import type { Verdict } from "../../types.ts";

export const VERDICT_SYM: Record<Verdict, string> = {
  passed: "✓",
  failed: "✗",
  errored: "!",
  skipped: "○",
};

export function verdictSymbol(verdict: string): string {
  return VERDICT_SYM[verdict as Verdict] ?? "?";
}
