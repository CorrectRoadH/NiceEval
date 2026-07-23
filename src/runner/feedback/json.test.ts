// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「形态解析与 --json 流不变量」
//
// `computeExitCode` 是 CompletionStatus 驱动退出码折叠的纯函数,直接单测。`renderJsonPlanDocument`
// 只需证明「单个 JSON 文档,不是 NDJSON 流」这条结构性不变量。json renderer 写出的逐事件字段、
// 心跳节奏、`--json` 不做 suppression 这些流不变量由 coordinator/reducer 驱动的事件序列断言
// (见 coordinator.test.ts/reducer.test.ts);具体字节级渲染由
// docs/engineering/testing/e2e/cli.md「反馈输出格式」在真实进程输出上验收。

import { describe, expect, it } from "vitest";
import { computeExitCode, renderJsonPlanDocument } from "./json.ts";
import type { InvocationCompletion, InvocationSummary } from "../types.ts";

function summary(overrides: Partial<InvocationSummary> = {}): InvocationSummary {
  return {
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

function completion(overrides: Partial<InvocationCompletion> = {}): InvocationCompletion {
  return { status: "complete", unstarted: 0, earlyExitUnstarted: 0, reporterErrors: [], ...overrides };
}

describe("computeExitCode:CompletionStatus 驱动退出码,不只看 failed/errored", () => {
  it("全部通过、complete → 0", () => {
    expect(computeExitCode(summary({ passed: 5, failed: 0, errored: 0 }), completion())).toBe(0);
  });

  it("有 failed → 1", () => {
    expect(computeExitCode(summary({ passed: 4, failed: 1 }), completion())).toBe(1);
  });

  it("有 errored → 1", () => {
    expect(computeExitCode(summary({ passed: 4, errored: 1 }), completion())).toBe(1);
  });

  it("budget 耗尽导致 unstarted、completion.status=incomplete → 1,即便全部已跑的都通过", () => {
    expect(
      computeExitCode(summary({ passed: 36, failed: 0, errored: 0 }), completion({ status: "incomplete", unstarted: 4 })),
    ).toBe(1);
  });

  it("用户/平台中断、completion.status=interrupted → 130", () => {
    expect(computeExitCode(summary({ passed: 3, failed: 0, errored: 0 }), completion({ status: "interrupted" }))).toBe(130);
  });

  it("required reporter 失败 → 1,即便全部 attempt 都通过", () => {
    expect(
      computeExitCode(
        summary({ passed: 10, failed: 0, errored: 0 }),
        completion({ reporterErrors: [{ reporter: "artifacts", required: true, message: "EACCES" }] }),
      ),
    ).toBe(1);
  });

  it("best-effort(非 required)reporter 失败不强制非零", () => {
    expect(
      computeExitCode(
        summary({ passed: 10, failed: 0, errored: 0 }),
        completion({ reporterErrors: [{ reporter: "custom", required: false, message: "network blip" }] }),
      ),
    ).toBe(0);
  });

  it("首过即停省略的 earlyExitUnstarted 不影响退出码(不是 budget 的 unstarted)", () => {
    expect(
      computeExitCode(summary({ passed: 10, failed: 0, errored: 0 }), completion({ earlyExitUnstarted: 6, unstarted: 0 })),
    ).toBe(0);
  });
});

describe("renderJsonPlanDocument:单个 ExpPlanDocument,不是事件流", () => {
  it("输出恰好一行 JSON,可解析为单个对象而不是逐行事件序列", () => {
    const text = renderJsonPlanDocument({
      total: 4,
      evals: 1,
      configs: 4,
      runs: 1,
      matrix: [
        { experimentId: "compare/bub-e2b", evalId: "memory/commit0-cachetool", reused: false },
        { experimentId: "compare/codex", evalId: "memory/commit0-cachetool", reused: true },
      ],
    });
    const lines = text.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const doc = JSON.parse(lines[0]!);
    expect(doc.format).toBe("niceeval.exp-plan");
    expect(typeof doc.schemaVersion).toBe("number");
    expect(doc.total).toBe(4);
    expect(doc.evals).toBe(1);
    expect(doc.configs).toBe(4);
    expect(doc.runs).toBe(1);
    expect(doc.matrix).toHaveLength(2);
  });

  it("reused 是 matrix 逐行 reused 之和(命中数量,不是 attempt 数)", () => {
    const text = renderJsonPlanDocument({
      total: 3,
      evals: 3,
      configs: 1,
      runs: 1,
      matrix: [
        { experimentId: "e", evalId: "a", reused: true },
        { experimentId: "e", evalId: "b", reused: true },
        { experimentId: "e", evalId: "c", reused: false },
      ],
    });
    const doc = JSON.parse(text.trim());
    expect(doc.reused).toBe(2);
  });

  it("零命中缓存时 reused 为 0", () => {
    const text = renderJsonPlanDocument({
      total: 1,
      evals: 1,
      configs: 1,
      runs: 1,
      matrix: [{ experimentId: "e", evalId: "a", reused: false }],
    });
    expect(JSON.parse(text.trim()).reused).toBe(0);
  });
});
