// cases: docs/engineering/testing/unit/reports.md
// 「show 终端宿主的选择、时间轴与文案」行:紧凑索引行的判定原因(verdictReasonLine)对多行
// `error.message` 折首行并剥控制字节收口——diagnose 从第二行起的 output tail 不进单行面,
// 完整多行 message 归 attempt 详情块展开。
// bug: memory/diagnose-tail-inline-defeats-one-line-elision.md

import { describe, expect, it } from "vitest";
import { verdictReasonLine } from "./render.ts";
import type { EvalResult } from "../types.ts";

function erroredResult(message: string): EvalResult {
  return {
    id: "react-datepicker/pr-6168",
    agent: "bub",
    verdict: "errored",
    attempt: 0,
    durationMs: 1,
    assertions: [],
    error: { code: "turn-failed", message, phase: "eval.run" },
  };
}

describe("verdictReasonLine 的 errored 单行收口", () => {
  it("多行 message 只取首行,tail 的框线不进紧凑索引行", () => {
    const line = verdictReasonLine(
      erroredResult("agent run exited with code 1 · last error: rate limited\noutput tail:\n│ ❱ 205 │ raise APIError("),
    );
    expect(line).toBe("agent run exited with code 1 · last error: rate limited");
    expect(line).not.toContain("│");
  });

  it("单行 message 原样保留", () => {
    expect(verdictReasonLine(erroredResult("sandbox allocation failed"))).toBe("sandbox allocation failed");
  });
});
