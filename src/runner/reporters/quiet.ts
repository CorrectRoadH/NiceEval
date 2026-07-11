// Quiet 报告器:--quiet 下的最小结果流。进度流照旧(attempt 无 onProgress 时直写 stderr),
// 这里只补「坏结果」:verdict 为 errored / failed 的结果各写一行 stderr,passed / skipped
// 静默 —— 保证 --quiet 下起沙箱失败这类执行错不会全程无声、只能事后读 summary.json。
// 结果流仍走统一的 Reporter 管线,不在 attempt 里散写。

import type { EvalResult, Reporter } from "../../types.ts";
import { t } from "../../i18n/index.ts";
import { runWho } from "../types.ts";
import { verdictSymbol } from "./shared.ts";

/** error / 断言 detail 的截断上限;比 Console 的 400 更紧,--quiet 只要能定位问题。 */
const DETAIL_MAX = 200;

/** 纯函数:一条结果 → 该写 stderr 的行;passed / skipped 返回 undefined(静默)。 */
export function quietLine(result: EvalResult): string | undefined {
  if (result.verdict !== "errored" && result.verdict !== "failed") return undefined;
  // [who] 与 attempt 进度行同源(runWho),两条流才能对上同一个运行配置。
  const who = runWho({ agentName: result.agent, model: result.model, experimentId: result.experimentId });
  const verdict = result.verdict === "errored" ? t("report.errored") : t("report.failed");
  const detail =
    result.error !== undefined
      ? `${t("report.error")}: ${truncate(result.error, DETAIL_MAX)}`
      : firstFailedAssertion(result);
  return `  ${verdictSymbol(result.verdict)} ${result.id} ${verdict}  [${who}]${detail ? `  ${detail}` : ""}\n`;
}

function firstFailedAssertion(result: EvalResult): string | undefined {
  const a = result.assertions.find((x) => !x.passed);
  if (!a) return undefined;
  const sev = a.severity === "gate" ? t("report.gate") : t("report.soft");
  const thr =
    a.threshold !== undefined
      ? t("report.assertionThreshold", { score: a.score.toFixed(2), threshold: a.threshold })
      : "";
  return `${sev}: ${a.name}${thr}${a.detail ? ` — ${truncate(a.detail, DETAIL_MAX)}` : ""}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function Quiet(): Reporter {
  return {
    onEvalComplete(result: EvalResult) {
      const line = quietLine(result);
      if (line !== undefined) process.stderr.write(line);
    },
  };
}
