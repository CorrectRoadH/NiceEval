// cases: docs/engineering/testing/unit/reports.md
// groupMatrixData(得分点 = 组的下钻矩阵):行按 groupPath 子树折叠、同一 attempt 内多个并列组
// 各自独立、行天然按 (eval, groupPath) 区分、同 eval 多 attempt 字面相同组名聚合进同一行而字面
// 不同各自成行、稀疏格子;计分制读组内挣分与中止定位、通过制读组内质量分与 gate 定位;refs 只跟
// samples 不跟 total。

import { describe, expect, it } from "vitest";
import type { AssertionResult, EvalResult, ScoreEntry, Verdict } from "../../../types.ts";
import type { AttemptHandle, Snapshot } from "../../../results/index.ts";
import { attemptHandleOf, scopeOf } from "../scope.harness.ts";
import { groupMatrixData } from "./compute.ts";
import { validateGroupMatrixData } from "./index.tsx";

let seq = 0;
function res(id: string, verdict: Verdict, extra: Partial<EvalResult> = {}): EvalResult {
  seq += 1;
  return {
    id,
    agent: "agent-x",
    verdict,
    attempt: 0,
    startedAt: `2026-07-01T00:00:00.${String(seq).padStart(6, "0")}Z`,
    durationMs: 1000,
    assertions: [],
    ...extra,
  };
}

function gate(name: string, groupPath: string[] | undefined, outcome: "passed" | "failed"): AssertionResult {
  return {
    name,
    severity: "gate",
    score: outcome === "passed" ? 1 : 0,
    outcome,
    ...(groupPath ? { groupPath } : {}),
  } as AssertionResult;
}

function soft(name: string, groupPath: string[] | undefined, score: number): AssertionResult {
  return { name, severity: "soft", score, outcome: "passed" as const, ...(groupPath ? { groupPath } : {}) } as AssertionResult;
}

function pointsAssertion(
  name: string,
  groupPath: string[] | undefined,
  points: number,
  outcome: "passed" | "failed" = "passed",
): AssertionResult {
  return {
    name,
    severity: "gate",
    score: outcome === "passed" ? 1 : 0,
    outcome,
    points,
    ...(groupPath ? { groupPath } : {}),
  } as AssertionResult;
}

function scoreEntry(label: string, groupPath: string[] | undefined, points: number): ScoreEntry {
  return { label, points, ...(groupPath ? { groupPath } : {}) };
}

let runSeq = 0;
function snap(experimentId: string, results: EvalResult[], runStartedAt?: string): Snapshot {
  runSeq += 1;
  const startedAt = runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const snapshot = {
    experimentId,
    startedAt,
    completedAt: startedAt,
    agent: "agent-x",
    schemaVersion: 1,
    dir: `/results/${experimentId}/snap-${runSeq}`,
  } as Snapshot;
  const attempts: AttemptHandle[] = results.map((r) =>
    attemptHandleOf(snapshot, r, {
      snapshot: `${experimentId}/snap-${runSeq}`,
      attempt: `${r.id}/a${r.attempt}`,
    }),
  );
  const evals = new Map<string, AttemptHandle[]>();
  for (const a of attempts) evals.set(a.evalId, [...(evals.get(a.evalId) ?? []), a]);
  snapshot.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  snapshot.attempts = attempts;
  return snapshot;
}

/** 从 data.cells 里取一个 (evalId, groupPath, column) 格子,方便断言。 */
function cellAt(data: Awaited<ReturnType<typeof groupMatrixData>>, evalId: string, groupPath: string[], column: string) {
  return data.cells.find(
    (c) => c.evalId === evalId && c.column === column && JSON.stringify(c.groupPath) === JSON.stringify(groupPath),
  )?.cell;
}

describe("groupMatrixData", () => {
  it("行按 groupPath 子树折叠:父组读到自身与后代组的证据,子组只读自己", async () => {
    const points = res("coding/refactor", "passed", {
      scoring: "points",
      experimentId: "exp-a",
      assertions: [
        pointsAssertion("lint clean", ["路由层"], 2),
        pointsAssertion("schema valid", ["路由层", "参数校验"], 3),
      ],
    });
    const scope = scopeOf([snap("exp-a", [points])]);
    const data = await groupMatrixData(scope);

    const parent = cellAt(data, "coding/refactor", ["路由层"], "exp-a");
    const child = cellAt(data, "coding/refactor", ["路由层", "参数校验"], "exp-a");
    expect(parent?.value).toBe(5); // 2(自身) + 3(后代)
    expect(child?.value).toBe(3); // 只读自己
  });

  it("同一 attempt 内多个并列组(互不嵌套)各自独立成行、互不污染", async () => {
    const points = res("coding/multi", "passed", {
      scoring: "points",
      experimentId: "exp-a",
      assertions: [pointsAssertion("a-check", ["A"], 1), pointsAssertion("b-check", ["B"], 4)],
    });
    const scope = scopeOf([snap("exp-a", [points])]);
    const data = await groupMatrixData(scope);

    expect(cellAt(data, "coding/multi", ["A"], "exp-a")?.value).toBe(1);
    expect(cellAt(data, "coding/multi", ["B"], "exp-a")?.value).toBe(4);
  });

  it("行天然按 (eval, groupPath) 区分:不同 eval 各自成行,不会合并成一行", async () => {
    const evalA = res("coding/a", "passed", {
      scoring: "points",
      experimentId: "exp-a",
      assertions: [pointsAssertion("check", ["correctness"], 10)],
    });
    const evalB = res("coding/b", "passed", {
      scoring: "points",
      experimentId: "exp-a",
      assertions: [pointsAssertion("check", ["correctness"], 20)],
    });
    const scope = scopeOf([snap("exp-a", [evalA, evalB])]);
    const data = await groupMatrixData(scope);

    const rowKeys = data.rows.map((r) => `${r.evalId}|${r.groupPath.join(">")}`);
    expect(rowKeys).toEqual(["coding/a|correctness", "coding/b|correctness"]);
    expect(cellAt(data, "coding/a", ["correctness"], "exp-a")?.value).toBe(10);
    expect(cellAt(data, "coding/b", ["correctness"], "exp-a")?.value).toBe(20);
  });

  it("同一 eval 多个 attempt(runs>1)用了字面相同的组名时聚合进同一行,字面不同各自成行", async () => {
    const run0 = res("coding/retry", "passed", {
      scoring: "points",
      experimentId: "exp-a",
      attempt: 0,
      assertions: [pointsAssertion("check", ["correctness"], 6)],
    });
    const run1 = res("coding/retry", "passed", {
      scoring: "points",
      experimentId: "exp-a",
      attempt: 1,
      assertions: [pointsAssertion("check", ["correctness"], 10), pointsAssertion("extra", ["Correctness"], 99)],
    });
    const scope = scopeOf([snap("exp-a", [run0, run1])]);
    const data = await groupMatrixData(scope);

    // "correctness" 两次 attempt 都命中,聚合(均值)进同一行;"Correctness"(大小写不同)只在一次 attempt 里出现,单独成行
    expect(cellAt(data, "coding/retry", ["correctness"], "exp-a")?.value).toBe(8); // (6+10)/2
    expect(cellAt(data, "coding/retry", ["Correctness"], "exp-a")?.value).toBe(99);
  });

  it("某 experiment 从未涉及某 groupPath 时该格缺失(稀疏),不是 0 或 null 占位", async () => {
    const withGroup = res("coding/x", "passed", {
      scoring: "points",
      experimentId: "exp-a",
      assertions: [pointsAssertion("check", ["only-here"], 1)],
    });
    const withoutGroup = res("coding/x", "passed", { scoring: "points", experimentId: "exp-b", assertions: [] });
    const scope = scopeOf([snap("exp-a", [withGroup]), snap("exp-b", [withoutGroup])]);
    const data = await groupMatrixData(scope);

    expect(cellAt(data, "coding/x", ["only-here"], "exp-a")).toBeDefined();
    expect(cellAt(data, "coding/x", ["only-here"], "exp-b")).toBeUndefined();
    // 稀疏体现在没有格子,而不是一个 value: null 的格子
    expect(data.cells.some((c) => c.evalId === "coding/x" && c.column === "exp-b")).toBe(false);
  });

  it("计分制:value 为组子树内 .points() 与 t.score 之和,没有给分项时为 null 不编 0", async () => {
    const scored = res("coding/score", "passed", {
      scoring: "points",
      experimentId: "exp-a",
      assertions: [pointsAssertion("check", ["scored"], 3), gate("no points here", ["gate-only"], "passed")],
      scoreEntries: [scoreEntry("代码精简", ["scored"], 7)],
    });
    const scope = scopeOf([snap("exp-a", [scored])]);
    const data = await groupMatrixData(scope);

    expect(cellAt(data, "coding/score", ["scored"], "exp-a")?.value).toBe(10); // 3 + 7
    // gate-only 组子树没有任何给分项(只有一个不带 .points 的 gate),没有满分声明,不编 0
    expect(cellAt(data, "coding/score", ["gate-only"], "exp-a")?.value).toBeNull();
  });

  it("计分制:.gate() 中止发生在某 groupPath 时该行 localizedFailure 为真,祖先行不因子行中止而误标", async () => {
    const aborted = res("coding/abort", "failed", {
      scoring: "points",
      experimentId: "exp-a",
      assertions: [
        pointsAssertion("outer ok", ["outer"], 5),
        pointsAssertion("inner gate", ["outer", "inner"], 0, "failed"),
      ],
    });
    const scope = scopeOf([snap("exp-a", [aborted])]);
    const data = await groupMatrixData(scope);

    expect(cellAt(data, "coding/abort", ["outer", "inner"], "exp-a")?.localizedFailure).toBe(true);
    // 中止发生在 inner,不是 outer 自己——outer 行不应该被误标成"死在这一层"
    expect(cellAt(data, "coding/abort", ["outer"], "exp-a")?.localizedFailure).toBe(false);
  });

  it("通过制:value 为组子树内 soft 断言的无权均值,.points 与 gate 断言不进这个均值", async () => {
    const passing = res("qa/check", "passed", {
      experimentId: "exp-a",
      assertions: [
        soft("judge quality", ["quality"], 0.6),
        soft("judge tone", ["quality"], 1.0),
        gate("must have", ["quality"], "passed"), // gate 不进质量分
      ],
    });
    const scope = scopeOf([snap("exp-a", [passing])]);
    const data = await groupMatrixData(scope);

    expect(cellAt(data, "qa/check", ["quality"], "exp-a")?.value).toBeCloseTo(0.8, 5); // (0.6+1.0)/2
  });

  it("通过制:某 gate 直接失败时该行 localizedFailure 为真,更深后代组失败时只有后代行标真", async () => {
    const failing = res("qa/nested", "failed", {
      experimentId: "exp-a",
      assertions: [
        soft("outer soft", ["outer"], 0.9),
        gate("inner must", ["outer", "inner"], "failed"),
      ],
    });
    const scope = scopeOf([snap("exp-a", [failing])]);
    const data = await groupMatrixData(scope);

    expect(cellAt(data, "qa/nested", ["outer", "inner"], "exp-a")?.localizedFailure).toBe(true);
    expect(cellAt(data, "qa/nested", ["outer"], "exp-a")?.localizedFailure).toBe(false);
  });

  it("refs 只收对这个 groupPath 子树有过证据的 attempt,不收从未进入这个 t.group 的 attempt", async () => {
    const touched = res("qa/refs", "passed", {
      experimentId: "exp-a",
      attempt: 0,
      assertions: [soft("in group", ["g"], 1)],
    });
    const untouched = res("qa/refs", "passed", {
      experimentId: "exp-a",
      attempt: 1,
      assertions: [], // 这次 attempt 完全没进入 t.group("g", ...)
    });
    const scope = scopeOf([snap("exp-a", [touched, untouched])]);
    const data = await groupMatrixData(scope);

    const cell = cellAt(data, "qa/refs", ["g"], "exp-a")!;
    expect(cell.samples).toBe(1); // 只有一个 attempt 真的涉及这个组
    expect(cell.total).toBe(2); // 分母是该 (eval, experiment) 的全部 attempt
    expect(cell.refs).toHaveLength(1);
  });

  it("没有 t.group 的 eval 不产生任何行", async () => {
    const ungrouped = res("plain/eval", "passed", { experimentId: "exp-a", assertions: [gate("bare check", undefined, "passed")] });
    const scope = scopeOf([snap("exp-a", [ungrouped])]);
    const data = await groupMatrixData(scope);

    expect(data.rows).toEqual([]);
    expect(data.cells).toEqual([]);
  });

  it("evals 前缀过滤:与 CLI 位置参数同语义", async () => {
    const a = res("coding/a", "passed", { scoring: "points", experimentId: "exp-a", assertions: [pointsAssertion("c", ["g"], 1)] });
    const b = res("other/b", "passed", { scoring: "points", experimentId: "exp-a", assertions: [pointsAssertion("c", ["g"], 1)] });
    const scope = scopeOf([snap("exp-a", [a, b])]);
    const data = await groupMatrixData(scope, { evals: "coding/" });

    expect(data.rows.map((r) => r.evalId)).toEqual(["coding/a"]);
  });
});

describe("validateGroupMatrixData", () => {
  const validCell = {
    value: 3,
    display: "3 pts",
    localizedFailure: false,
    samples: 1,
    total: 1,
    refs: ["@1abcdef2"],
  };
  const valid = {
    rows: [{ evalId: "coding/a", groupPath: ["g"], scoring: "points" }],
    columns: ["exp-a"],
    cells: [{ evalId: "coding/a", groupPath: ["g"], column: "exp-a", cell: validCell }],
  };

  it("合规 literal 通过", () => {
    expect(validateGroupMatrixData(valid)).toBeNull();
  });

  it("row.scoring 不在 pass/points 二态内报错", () => {
    const bad = { ...valid, rows: [{ ...valid.rows[0], scoring: "mixed" }] };
    expect(validateGroupMatrixData(bad)).toMatch(/"rows\[0\]\.scoring"/);
  });

  it("cell 缺 localizedFailure 报错(与通用 MetricCell 校验的区别点)", () => {
    const bad = { ...valid, cells: [{ ...valid.cells[0], cell: { ...validCell, localizedFailure: undefined } }] };
    expect(validateGroupMatrixData(bad)).toMatch(/localizedFailure/);
  });

  it("groupPath 非字符串数组报错", () => {
    const bad = { ...valid, rows: [{ ...valid.rows[0], groupPath: "g" }] };
    expect(validateGroupMatrixData(bad)).toMatch(/"rows\[0\]\.groupPath"/);
  });
});
