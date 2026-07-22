// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「human renderer 的面板接线到 panel.ts」:证明 renderDurableLines / live dashboard
// 真的把内容交给 panel.ts 的 renderPanel,而不是各自拼框字符——面板几何本身(截断优先级、
// 宽度上限、CJK 量测……)由 src/report/model/panel.test.ts 覆盖,这里只断言「确实调用了」:
// boxed 能力下产生可识别的框线字符与正确的面板顺序/分隔,plain/非 TTY 下不产生任何框字符。

import { afterEach, describe, expect, it } from "vitest";
import { createHumanRenderer, renderDurableLines } from "./human.ts";
import { createFakeFeedbackIO } from "./testing.ts";
import { createInitialRunFeedbackState } from "./reducer.ts";
import { encodeAttemptKey } from "../types.ts";
import type { DurableFeedbackEvent, RunCompletion, RunFeedbackPlan, RunFeedbackState, RunSummary } from "../types.ts";
import type { AttemptLocator } from "../../results/locator.ts";

function locator(raw: string): AttemptLocator {
  return raw as AttemptLocator;
}

function plan(overrides: Partial<RunFeedbackPlan> = {}): RunFeedbackPlan {
  return {
    shape: { evals: 9, configs: 5, totalRuns: 45, maxConcurrency: 19 },
    reused: 6,
    reusedFailures: [],
    ...overrides,
  };
}

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    agent: "codex",
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:03:48.000Z",
    passed: 44,
    failed: 1,
    skipped: 0,
    errored: 0,
    durationMs: 228_000,
    results: [],
    ...overrides,
  };
}

function completion(overrides: Partial<RunCompletion> = {}): RunCompletion {
  return { status: "complete", unstarted: 0, earlyExitUnstarted: 0, reporterErrors: [], ...overrides };
}

const BOX_CHARS = /[╭╮╰╯├┤]/;

function stateWithFailureAndKept(): RunFeedbackState {
  const base = createInitialRunFeedbackState();
  return {
    ...base,
    total: 45,
    reused: 6,
    failures: [
      {
        at: 0,
        locator: locator("@1bwcxxiy"),
        identity: { experimentId: "compare", evalId: "memory/swelancer-manager-15193", attempt: 0 },
        who: "dev-e2b/claude-e2b",
        verdict: "failed",
        reason: "gate failed",
      },
    ],
    kept: [
      {
        at: 0,
        locator: locator("@1x7f3q9k"),
        identity: { experimentId: "compare", evalId: "onboarding/tool-first", attempt: 0 },
        who: "compare/bub-e2b",
        verdict: "errored",
        provider: "docker",
        sandboxId: "a3f9c2d1",
      },
    ],
  };
}

describe("renderDurableLines — 面板事件接线到 panel.ts", () => {
  it("plan 事件在 boxed 能力下产生 PLAN 面板(panel.ts 的框线字符,不是手拼)", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = { type: "plan", at: 0, plan: plan() };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    expect(lines[0]).toMatch(/^╭─ PLAN /);
    expect(lines.at(-1)).toMatch(/^╰─+╯$/);
    expect(lines.join("\n")).toContain("45 attempts");
    expect(lines.join("\n")).toContain("6 of 45 carried in from cache");
  });

  it("plan 事件在 plain 能力下不产生任何框字符,内容仍完整", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = { type: "plan", at: 0, plan: plan() };
    const lines = renderDurableLines(event, state, { mode: "plain", width: 82 });
    expect(lines.join("\n")).not.toMatch(BOX_CHARS);
    expect(lines.join("\n")).toContain("PLAN");
    expect(lines.join("\n")).toContain("45 attempts");
  });

  it("summary 事件产生三个独立的面板(FAILED/FAILURES/KEPT SANDBOXES),各自成框、之间空行分隔", () => {
    const state = stateWithFailureAndKept();
    const event: DurableFeedbackEvent = { type: "summary", at: 0, summary: summary(), completion: completion() };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    const text = lines.join("\n");
    // 三个面板各自的完整边框都出现
    expect(lines.filter((l) => /^╭/.test(l))).toHaveLength(3);
    expect(lines.filter((l) => /^╰/.test(l))).toHaveLength(3);
    expect(text).toMatch(/^╭─ FAILED /m);
    expect(text).toMatch(/^╭─ FAILURES/m);
    expect(text).toMatch(/^╭─ KEPT SANDBOXES /m);
    // 面板之间用空行分隔(不是紧贴在一起的三个框)
    expect(text).toMatch(/╯\n\n╭/);
    // 留存面板下边框嵌批量清理命令,内容携带 locator/provider/enter 命令
    expect(text).toContain("niceeval sandbox stop --all");
    expect(text).toContain("enter: niceeval sandbox enter a3f9c2d1");
  });

  it("summary 事件在 plain 能力下不产生任何框字符,三块内容仍都存在", () => {
    const state = stateWithFailureAndKept();
    const event: DurableFeedbackEvent = { type: "summary", at: 0, summary: summary(), completion: completion() };
    const lines = renderDurableLines(event, state, { mode: "plain", width: 82 });
    const text = lines.join("\n");
    expect(text).not.toMatch(BOX_CHARS);
    expect(text).toContain("FAILED");
    expect(text).toContain("FAILURES");
    expect(text).toContain("KEPT SANDBOXES");
  });

  it("全部通过、没有留存时只有一个 FAILED/PASSED 面板,不留空的 FAILURES/KEPT SANDBOXES 框", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = {
      type: "summary",
      at: 0,
      summary: summary({ passed: 45, failed: 0, errored: 0 }),
      completion: completion(),
    };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    expect(lines.filter((l) => /^╭/.test(l))).toHaveLength(1);
    expect(lines[0]).toMatch(/^╭─ PASSED /);
  });

  it("saved 事件产生 NEXT 面板,内嵌 RESULTS 横隔(不是独立的第二个框)", () => {
    const state = stateWithFailureAndKept();
    const event: DurableFeedbackEvent = {
      type: "saved",
      at: 0,
      paths: [".niceeval/compare/bub-e2b/s1", ".niceeval/compare/codex/s2"],
    };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    const text = lines.join("\n");
    expect(lines[0]).toMatch(/^╭─ NEXT /);
    expect(lines.filter((l) => /^╭/.test(l))).toHaveLength(1); // 只有最外层一个框
    expect(text).toMatch(/^├─ RESULTS ─+┤$/m);
    expect(text).toContain("Inspect: niceeval show @1bwcxxiy"); // 首条失败的下钻命令
    expect(text).toContain("Compare: niceeval view");
    expect(text).toContain(".niceeval/compare/bub-e2b/s1");
  });

  it("saved 事件在没有失败时,NEXT 面板不包含下钻命令,只有 Compare 与 RESULTS", () => {
    const state = createInitialRunFeedbackState();
    const event: DurableFeedbackEvent = { type: "saved", at: 0, paths: [".niceeval/compare/s1"] };
    const lines = renderDurableLines(event, state, { mode: "boxed", width: 82 });
    const text = lines.join("\n");
    expect(text).not.toContain("Inspect:");
    expect(text).toContain("Compare: niceeval view");
    expect(text).toMatch(/^├─ RESULTS ─+┤$/m);
  });
});

describe("live dashboard — 接线到 panel.ts", () => {
  afterEach(() => {
    // 无需清理:createHumanRenderer 不挂全局状态,只是确保测试之间互不影响的显式记号。
  });

  it("TTY + boxed 能力下,live 面板产生完整框线,ACTIVE 降为横隔而不是独立框", () => {
    const { io, stderr } = createFakeFeedbackIO({ stderr: { isTTY: true, columns: 82, rows: 30 } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    const identity = { experimentId: "compare", evalId: "memory/agent-029-use-cac", attempt: 0 };
    const key = encodeAttemptKey(identity);
    const state: RunFeedbackState = {
      ...createInitialRunFeedbackState(),
      total: 45,
      reused: 6,
      running: 19,
      queued: 12,
      completed: 8,
      elapsedMs: 134_000,
      estimatedCostUSD: 0.84,
      active: new Map([[key, { identity, who: "compare/bub-e2b", phase: "eval.run", phaseStartedAt: 0 }]]),
    };
    renderer.onLifecycle?.({ type: "attempt:start", at: 0, identity, who: "compare/bub-e2b", phase: "eval.run" }, state);
    renderer.redrawDynamic?.(state);

    const written = stderr.writes.join("");
    // eslint-disable-next-line no-control-regex
    const plain = written.replace(/\x1B\[[0-9]*[A-Za-z]/g, "");
    expect(plain).toMatch(/^╭─ niceeval exp compare /);
    expect(plain).toMatch(/├─ ACTIVE ─+┤/);
    expect(plain).toMatch(/╰─+ \$0\.84\d* ─╯/);
    expect(plain).toContain("memory/agent-029-use-cac".slice(0, 10)); // 身份列可能因窄宽被截断,只核对前缀
  });

  it("非 TTY(append-only 变体)不产生任何框字符——同一 renderDurableLines 但走 plain 能力", () => {
    const { io, stdout, stderr } = createFakeFeedbackIO({ stderr: { isTTY: false } });
    const renderer = createHumanRenderer({ io, command: "niceeval exp compare" });
    renderer.appendDurable(
      { type: "plan", at: 0, plan: plan() },
      { ...createInitialRunFeedbackState(), total: 45, reused: 6 },
    );
    const written = stdout.writes.join("") + stderr.writes.join("");
    expect(written).not.toMatch(BOX_CHARS);
    expect(written).toContain("PLAN");
  });
});
