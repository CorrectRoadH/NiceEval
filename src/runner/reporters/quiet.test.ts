import { describe, expect, it } from "vitest";
import { quietLine } from "./quiet.ts";
import type { EvalResult } from "../../types.ts";

function baseResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "algebra/quadratic",
    agent: "codex",
    verdict: "passed",
    attempt: 0,
    durationMs: 42_000,
    assertions: [],
    ...overrides,
  };
}

describe("quietLine", () => {
  it("passed / skipped 静默(返回 undefined)", () => {
    expect(quietLine(baseResult())).toBeUndefined();
    expect(quietLine(baseResult({ verdict: "skipped", skipReason: "no api key" }))).toBeUndefined();
  });

  it("errored 带 eval id、[who] 与截断后的 error", () => {
    const line = quietLine(
      baseResult({
        verdict: "errored",
        model: "gpt-5",
        error: "sandbox create failed: e2b timeout after 3.9s",
      }),
    );
    expect(line).toContain("algebra/quadratic");
    expect(line).toContain("[codex/gpt-5]");
    expect(line).toContain("errored");
    expect(line).toContain("e2b timeout after 3.9s");
  });

  it("[who] 与进度行同源:有 experimentId 时用其 basename", () => {
    const line = quietLine(
      baseResult({ verdict: "errored", experimentId: "compare/xxx--agents-md", error: "boom" }),
    );
    expect(line).toContain("[xxx--agents-md]");
  });

  it("failed 无 error 时取首个失败断言(severity、阈值、detail)", () => {
    const line = quietLine(
      baseResult({
        verdict: "failed",
        assertions: [
          { name: "compiles", severity: "gate", score: 1, passed: true },
          { name: "closedQA", severity: "gate", score: 0.2, passed: false, threshold: 0.7, detail: "wrong city" },
        ],
      }),
    );
    expect(line).toContain("failed");
    expect(line).toContain("closedQA");
    expect(line).toContain("0.20");
    expect(line).toContain("wrong city");
    expect(line).not.toContain("compiles");
  });

  it("超长 error 截断到 200 字符并加省略号", () => {
    const line = quietLine(baseResult({ verdict: "errored", error: "x".repeat(500) }))!;
    expect(line).toContain("…");
    expect(line.length).toBeLessThan(300);
  });
});
