// 控制台报告器:流式逐行输出,失败断言内联展开,末尾出效率三件套(时间 / token / $)。

import type { EvalResult, Reporter, RunSummary } from "../../types.ts";

const SYMBOL: Record<string, string> = {
  passed: "✓",
  failed: "✗",
  scored: "~",
  skipped: "○",
};

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(0)}s`;
  return `${ms}ms`;
}

export function Console(): Reporter {
  return {
    onRunStart(evals) {
      process.stdout.write(`\n本次运行 ${evals.length} 个 eval\n\n`);
    },
    onEvalComplete(result: EvalResult) {
      const sym = SYMBOL[result.verdict] ?? "?";
      const tok = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
      // requests > 0 但 tokens = 0 → agent 跑了但不上报用量(如 bub);显示 — 而非误导性的 0
      const tokStr = tok > 0 ? `${fmtTokens(tok)} tok` : (result.usage?.requests ?? 0) > 0 ? `— tok` : `0 tok`;
      const cost = result.estimatedCostUSD !== undefined ? `  $${result.estimatedCostUSD.toFixed(3)}` : "";
      const who = result.model ? `${result.agent}/${result.model}` : result.agent;
      const meta = `(${fmtDuration(result.durationMs)}  ${tokStr}${cost})`;
      process.stdout.write(`  ${sym} ${result.id}  [${who}]  ${meta}\n`);

      if (result.skipReason) {
        process.stdout.write(`      ○ skipped: ${result.skipReason}\n`);
      }
      if (result.error) {
        process.stdout.write(`      ! error: ${truncate(result.error, 400)}\n`);
      }
      let lastGroup: string | undefined;
      for (const a of result.assertions) {
        if (a.passed) continue;
        if (a.group !== undefined && a.group !== lastGroup) {
          process.stdout.write(`      ▸ ${a.group}\n`);
        }
        lastGroup = a.group;
        const sev = a.severity === "gate" ? "gate" : "soft";
        const thr = a.threshold !== undefined ? ` (got ${a.score.toFixed(2)} < ${a.threshold})` : "";
        const indent = a.group !== undefined ? "        " : "      ";
        process.stdout.write(`${indent}- ${sev}: ${a.name}${thr}${a.detail ? ` — ${truncate(a.detail, 300)}` : ""}\n`);
      }
    },
    onRunComplete(summary: RunSummary) {
      const tok = (summary.usage?.inputTokens ?? 0) + (summary.usage?.outputTokens ?? 0);
      const tokStr = tok > 0 ? `${fmtTokens(tok)} tok` : "— tok";
      const cost = summary.estimatedCostUSD !== undefined ? ` · $${summary.estimatedCostUSD.toFixed(2)}` : "";
      process.stdout.write(
        `\n结果:${summary.passed} passed, ${summary.failed} failed, ${summary.scored} scored, ${summary.skipped} skipped` +
          `  (${fmtDuration(summary.durationMs)} · ${tokStr}${cost})\n\n`,
      );
    },
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
