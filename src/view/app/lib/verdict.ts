import type { Verdict, ViewResult } from "../types.ts";
import type { T } from "../shared.ts";
import { compactAssertionSummary, primaryAssertionSummary } from "../../../scoring/display.ts";
import type { Verdict as CoreVerdict } from "../../../scoring/types.ts";

export function verdictClass(verdict: Verdict): string {
  return verdict === "passed" ? "good" : verdict === "errored" ? "infra-err" : verdict === "failed" ? "bad" : "warn";
}

export function verdictLabel(verdict: Verdict, t: T): string {
  if (verdict === "passed") return t("status.pass");
  if (verdict === "failed") return t("status.fail");
  if (verdict === "errored") return t("status.error");
  if (verdict === "skipped") return t("status.skipped");
  return verdict || "—";
}

export function reasonFor(result: ViewResult): string {
  if (result.error) return result.error.message;
  if (result.skipReason) return result.skipReason;
  const summary = primaryAssertionSummary(result.assertions ?? [], result.verdict as CoreVerdict);
  return summary ? compactAssertionSummary(summary) : "";
}
