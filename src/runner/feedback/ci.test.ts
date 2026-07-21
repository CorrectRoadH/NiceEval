// cases: docs/engineering/testing/unit/experiments-runner.md
// computeCiExitCode 是 CompletionStatus 驱动退出码折叠的纯函数(RunSummary + RunCompletion →
// 数字),直接单测。ci renderer 写出的具体行文本(envelope 字段、心跳节奏、失败展开上限、
// stdout/stderr 流边界……)不是数据语义,由 docs/engineering/testing/e2e/cli.md「反馈输出格式」
// 在真实进程输出上验收。

import { describe, expect, it } from "vitest";
import { computeCiExitCode } from "./ci.ts";
import type { RunCompletion, RunSummary } from "../types.ts";

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    agent: "codex",
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:03:21.000Z",
    passed: 1,
    failed: 0,
    skipped: 0,
    errored: 0,
    durationMs: 60_000,
    results: [],
    ...overrides,
  };
}

function completion(overrides: Partial<RunCompletion> = {}): RunCompletion {
  return { status: "complete", unstarted: 0, earlyExitUnstarted: 0, reporterErrors: [], ...overrides };
}

describe("computeCiExitCode:CompletionStatus 驱动退出码,不只看 failed/errored", () => {
  it("全部通过、complete → 0", () => {
    expect(computeCiExitCode(summary({ passed: 5, failed: 0, errored: 0 }), completion())).toBe(0);
  });

  it("有 failed → 1", () => {
    expect(computeCiExitCode(summary({ passed: 4, failed: 1 }), completion())).toBe(1);
  });

  it("有 errored → 1", () => {
    expect(computeCiExitCode(summary({ passed: 4, errored: 1 }), completion())).toBe(1);
  });

  it("budget 耗尽导致 unstarted、completion.status=incomplete → 1,即便全部已跑的都通过", () => {
    expect(
      computeCiExitCode(summary({ passed: 36, failed: 0, errored: 0 }), completion({ status: "incomplete", unstarted: 4 })),
    ).toBe(1);
  });

  it("用户/平台中断、completion.status=interrupted → 130", () => {
    expect(computeCiExitCode(summary({ passed: 3, failed: 0, errored: 0 }), completion({ status: "interrupted" }))).toBe(130);
  });

  it("required reporter 失败 → 1,即便全部 attempt 都通过", () => {
    expect(
      computeCiExitCode(
        summary({ passed: 10, failed: 0, errored: 0 }),
        completion({ reporterErrors: [{ reporter: "artifacts", required: true, message: "EACCES" }] }),
      ),
    ).toBe(1);
  });

  it("best-effort(非 required)reporter 失败不强制非零", () => {
    expect(
      computeCiExitCode(
        summary({ passed: 10, failed: 0, errored: 0 }),
        completion({ reporterErrors: [{ reporter: "custom", required: false, message: "network blip" }] }),
      ),
    ).toBe(0);
  });

  it("首过即停省略的 earlyExitUnstarted 不影响退出码(不是 budget 的 unstarted)", () => {
    expect(
      computeCiExitCode(summary({ passed: 10, failed: 0, errored: 0 }), completion({ earlyExitUnstarted: 6, unstarted: 0 })),
    ).toBe(0);
  });
});
