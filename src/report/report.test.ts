// niceeval/report 计算层的单元测试:全部用内存 fake(Snapshot / AttemptHandle 按
// niceeval/results 的读取契约手工构造),专门覆盖 docs/reports.md 点名的坑 ——
// 两级聚合 vs 平铺、pass@k、examScore 空真、skipped 稀释、scoreboard 固定分母与
// 最长前缀、scatter/delta 的 null 语义、快照键对比、flag 维度与轴、
// cases 的 redact/truncated、身份键去重、Selection warnings 随行。

import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, O11ySummary, Verdict } from "../types.ts";
import type { AttemptHandle, Selection, SelectionWarning, Snapshot } from "../results/index.ts";
import type { Dimension, MetricCell } from "./types.ts";
import { costUSD, defineMetric, durationMs, examScore, passRate, tokens, turns } from "./metrics.ts";
import { flag } from "./flag.ts";
import { formatMetricValue } from "./format.ts";
import {
  CaseList,
  DeltaTable,
  GroupSummary,
  MetricBars,
  MetricLine,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  RunOverview,
  Scoreboard,
} from "./components.tsx";

// ───────────────────────── fake 数据(按 results 读取契约造)─────────────────────────

let seq = 0;

/** 造一条结果;默认给每条唯一 startedAt —— 身份键含 startedAt,免得普通样本被去重误伤。 */
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

function softAssertion(name: string, score: number, extra: Partial<AssertionResult> = {}): AssertionResult {
  return { name, severity: "soft", score, passed: true, ...extra };
}

/** 最小合规 O11ySummary,只有 totalTurns 会变;供 turns 指标测试内联挂到 EvalResult.o11y。 */
function o11ySummary(totalTurns: number): O11ySummary {
  return {
    totalTurns,
    toolCalls: {},
    totalToolCalls: 0,
    filesRead: [],
    filesModified: [],
    shellCommands: [],
    webFetches: [],
    errors: [],
    thinkingBlocks: 0,
    compactions: 0,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

interface SnapSpec {
  experimentId: string;
  results: EvalResult[];
  agent?: string;
  model?: string;
  runStartedAt?: string;
  knownEvalIds?: string[];
}

let runSeq = 0;

/** 最小构造:一个快照目录装一个快照。runStartedAt 决定去重时谁是「最新快照」。 */
function snap(spec: SnapSpec): Snapshot {
  runSeq += 1;
  const startedAt = spec.runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const dir = `/results/exp/snap-${runSeq}`;
  const snapshot = {
    experimentId: spec.experimentId,
    startedAt,
    completedAt: startedAt,
    agent: spec.agent ?? "agent-x",
    model: spec.model,
    schemaVersion: 1,
    dir,
    knownEvalIds: spec.knownEvalIds,
  } as Snapshot;
  const attempts: AttemptHandle[] = spec.results.map((r) => ({
    evalId: r.id,
    experimentId: r.experimentId ?? spec.experimentId,
    result: r,
    ref: { snapshot: `exp/snap-${runSeq}`, attempt: `${r.id}/a${r.attempt}` },
    snapshot,
    events: async () => null,
    trace: async () => null,
    o11y: async () => r.o11y ?? null,
    diff: async () => null,
    sources: async () => null,
  }));
  const evals = new Map<string, AttemptHandle[]>();
  for (const attempt of attempts) {
    const list = evals.get(attempt.evalId);
    if (list) list.push(attempt);
    else evals.set(attempt.evalId, [attempt]);
  }
  snapshot.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  snapshot.attempts = attempts;
  return snapshot;
}

/** 手工造一个 Selection(warnings 随行的形状,filter 语义与 results 一致)。 */
function selection(snapshots: Snapshot[], warnings: SelectionWarning[]): Selection {
  return {
    snapshots,
    warnings,
    filter(predicate) {
      const kept = snapshots.filter(predicate);
      const survivors = new Set(kept.map((s) => s.experimentId));
      return selection(
        kept,
        warnings.filter((w) => typeof w.experimentId !== "string" || survivors.has(w.experimentId)),
      );
    },
  };
}

// ───────────────────────── 两级聚合 ─────────────────────────

describe("两级聚合引擎", () => {
  it("题内先折再跨题平均:A=[1]、B=[0,0,0] → 0.5,不是平铺的 0.25", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [res("A", "passed"), res("B", "failed"), res("B", "failed"), res("B", "failed")],
    });
    const data = await MetricTable.data([s], { rows: "agent", columns: [passRate] });
    expect(data.dimension).toBe("agent");
    expect(data.rows).toHaveLength(1);
    const cell = data.rows[0].cells["pass-rate"];
    expect(cell.value).toBe(0.5);
    expect(cell.display).toBe("50%");
    expect(cell.samples).toBe(4);
    expect(cell.total).toBe(4);
    expect(cell.refs).toHaveLength(4);
  });

  it("pass@k = perEval:max —— k 次里过一次的题算过", async () => {
    const passAtK = defineMetric({
      name: "pass@k",
      better: "higher",
      unit: "%",
      value: (a) => (a.result.verdict === "skipped" ? null : a.result.verdict === "passed" ? 1 : 0),
      aggregate: { perEval: "max", across: "mean" },
    });
    const s = snap({
      experimentId: "exp/x",
      results: [res("A", "failed"), res("A", "failed"), res("B", "failed"), res("B", "passed")],
    });
    const data = await MetricTable.data([s], { rows: "agent", columns: [passAtK, passRate] });
    // A: max(0,0)=0;B: max(0,1)=1 → (0+1)/2
    expect(data.rows[0].cells["pass@k"].value).toBe(0.5);
    // 对照:默认 mean/mean 的 passRate = (0 + 0.5)/2
    expect(data.rows[0].cells["pass-rate"].value).toBe(0.25);
  });

  it("skipped 是 null:不稀释均值,但计入 total(覆盖率如实)", async () => {
    const s = snap({ experimentId: "exp/x", results: [res("A", "passed"), res("B", "skipped")] });
    const data = await MetricTable.data([s], { rows: "agent", columns: [passRate] });
    const cell = data.rows[0].cells["pass-rate"];
    expect(cell.value).toBe(1); // B 整桶为 null,不参与 across,不是 0.5
    expect(cell.samples).toBe(1);
    expect(cell.total).toBe(2);
    expect(cell.refs).toHaveLength(1);
  });

  it("全组 null → value null、display 兜底,不编 0;refs 必填(空数组)", async () => {
    const s = snap({ experimentId: "exp/x", results: [res("A", "skipped")] });
    const data = await MetricTable.data([s], { rows: "agent", columns: [passRate] });
    const cell = data.rows[0].cells["pass-rate"];
    expect(cell.value).toBeNull();
    expect(cell.display).toBe("—");
    expect(cell.samples).toBe(0);
    expect(cell.total).toBe(1);
    expect(cell.refs).toEqual([]);
  });

  it("where 不满足 → null,不进聚合", async () => {
    const onlyPassed = defineMetric({
      name: "only-passed",
      where: (a) => a.result.verdict === "passed",
      value: () => 5,
    });
    const s = snap({ experimentId: "exp/x", results: [res("A", "passed"), res("B", "failed")] });
    const data = await MetricTable.data([s], { rows: "agent", columns: [onlyPassed] });
    const cell = data.rows[0].cells["only-passed"];
    expect(cell.value).toBe(5);
    expect(cell.samples).toBe(1);
    expect(cell.total).toBe(2);
  });

  it("自定义维度:第一级折叠发生在各组内部", async () => {
    const byParity: Dimension = {
      name: "parity",
      of: (a) => (a.result.attempt % 2 === 0 ? "even" : "odd"),
    };
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "passed", { attempt: 0 }),
        res("A", "failed", { attempt: 1 }),
        res("A", "passed", { attempt: 2 }),
      ],
    });
    const data = await MetricTable.data([s], { rows: byParity, columns: [passRate] });
    expect(data.dimension).toBe("parity");
    const byKey = Object.fromEntries(data.rows.map((r) => [r.key, r.cells["pass-rate"].value]));
    // 同一道题的 attempt 分进两组:even 组内 [1,1] 折成 1,odd 组内 [0] 折成 0
    expect(byKey).toEqual({ even: 1, odd: 0 });
  });

  it("同一次计算里指标重名是错误", async () => {
    const dup = defineMetric({ name: "pass-rate", value: () => 1 });
    const s = snap({ experimentId: "exp/x", results: [res("A", "passed")] });
    await expect(MetricTable.data([s], { rows: "agent", columns: [passRate, dup] })).rejects.toThrow(
      /Duplicate metric name "pass-rate"/,
    );
  });

  it("sort 方向随 better,缺数据行沉底", async () => {
    const good = snap({ experimentId: "exp/good", agent: "good", results: [res("A", "passed", { agent: "good" })] });
    const bad = snap({ experimentId: "exp/bad", agent: "bad", results: [res("A", "failed", { agent: "bad" })] });
    const none = snap({ experimentId: "exp/none", agent: "none", results: [res("A", "skipped", { agent: "none" })] });
    const data = await MetricTable.data([none, bad, good], {
      rows: "agent",
      columns: [passRate],
      sort: passRate,
    });
    expect(data.rows.map((r) => r.key)).toEqual(["good", "bad", "none"]);
  });

  it("列键是字面量联合:拼错列名编译不过", async () => {
    const s = snap({ experimentId: "exp/x", results: [res("A", "passed")] });
    const data = await MetricTable.data([s], { rows: "agent", columns: [passRate, costUSD] });
    const cell: MetricCell = data.rows[0].cells[passRate.name]; // 键锚在指标对象上
    expect(cell.value).toBe(1);
    // @ts-expect-error 列里没有这个键 —— 编译期挡住,不是运行时 undefined
    data.rows[0].cells["pass-rat"];
  });
});

// ───────────────────────── examScore ─────────────────────────

describe("examScore", () => {
  it("errored(断言空数组)得 0 —— 不因「gate 全过」空真得满分", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [res("A", "errored", { assertions: [], error: "adapter crashed" })],
    });
    const data = await MetricTable.data([s], { rows: "agent", columns: [examScore] });
    const cell = data.rows[0].cells["exam-score"];
    expect(cell.value).toBe(0); // 交白卷是 0 分,不是缺数据,更不是满分
    expect(cell.samples).toBe(1);
  });

  it("failed 得 0,哪怕 soft 分不低(报告不重新判卷)", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [res("A", "failed", { assertions: [softAssertion("judge", 0.9)] })],
    });
    const data = await MetricTable.data([s], { rows: "agent", columns: [examScore] });
    expect(data.rows[0].cells["exam-score"].value).toBe(0);
  });

  it("passed:soft 均分;gate 不参与给分;无 soft 则满分 1", async () => {
    const withSoft = snap({
      experimentId: "exp/a",
      results: [
        res("A", "passed", {
          assertions: [
            softAssertion("judge-1", 0.5),
            softAssertion("judge-2", 1),
            { name: "includes", severity: "gate", score: 1, passed: true },
          ],
        }),
      ],
    });
    const noSoft = snap({
      experimentId: "exp/b",
      results: [
        res("B", "passed", {
          assertions: [{ name: "includes", severity: "gate", score: 1, passed: true }],
        }),
      ],
    });
    const a = await MetricTable.data([withSoft], { rows: "agent", columns: [examScore] });
    expect(a.rows[0].cells["exam-score"].value).toBe(0.75);
    const b = await MetricTable.data([noSoft], { rows: "agent", columns: [examScore] });
    expect(b.rows[0].cells["exam-score"].value).toBe(1);
  });

  it("skipped → null,不进聚合", async () => {
    const s = snap({ experimentId: "exp/x", results: [res("A", "skipped")] });
    const data = await MetricTable.data([s], { rows: "agent", columns: [examScore] });
    expect(data.rows[0].cells["exam-score"].value).toBeNull();
  });
});

// ───────────────────────── 内置指标口径 ─────────────────────────

describe("内置指标", () => {
  it("tokens 只加 input+output,缓存读写不计入;无 usage → null", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "passed", {
          usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 999_999, cacheWriteTokens: 888 },
        }),
        res("B", "failed"), // 无 usage → null,不稀释
      ],
    });
    const data = await MetricTable.data([s], { rows: "agent", columns: [tokens] });
    const cell = data.rows[0].cells["tokens"];
    expect(cell.value).toBe(1200);
    expect(cell.display).toBe("1.2k tokens");
    expect(cell.samples).toBe(1);
    expect(cell.total).toBe(2);
  });

  it("costUSD:网关实测优先于估算;durationMs 对 errored 取实测", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "passed", {
          usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.5 },
          estimatedCostUSD: 999, // 实测优先,不该被用到
        }),
        res("B", "errored", { durationMs: 3000 }),
      ],
    });
    const cost = await MetricTable.data([s], { rows: "agent", columns: [costUSD] });
    expect(cost.rows[0].cells["cost"].value).toBe(0.5);
    const dur = await MetricTable.data([s], { rows: "agent", columns: [durationMs] });
    expect(dur.rows[0].cells["duration"].value).toBe(2000); // (1000 + 3000)/2,errored 实测照算
  });

  it("turns:读 o11y.totalTurns;o11y 缺失(未随发布带上)→ null,不是 0;skipped 不进聚合", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "passed", { o11y: o11ySummary(12) }),
        res("B", "failed"), // 没带 o11y(如 copySnapshots 漏选 artifact)→ null,不稀释成 0
        res("C", "skipped", { o11y: o11ySummary(3) }), // skipped 恒 null,哪怕 o11y 在场
      ],
    });
    const data = await MetricTable.data([s], { rows: "agent", columns: [turns] });
    const cell = data.rows[0].cells["turns"];
    expect(cell.value).toBe(12);
    expect(cell.samples).toBe(1); // 只有 A 测得了(B 缺 o11y、C 是 skipped)
    expect(cell.total).toBe(3); // total 是组内全部 attempt 数,不是「本该测得」的分母
  });
});

// ───────────────────────── Scoreboard.data ─────────────────────────

describe("Scoreboard.data", () => {
  it("固定分母 + missing 如实 + 权重最长前缀生效", async () => {
    const alpha = snap({
      experimentId: "exp/alpha",
      agent: "alpha",
      results: [
        res("algebra/x", "passed", { agent: "alpha" }),
        res("algebra/hard/y", "passed", { agent: "alpha" }),
        res("geometry/z", "passed", { agent: "alpha" }),
      ],
    });
    const beta = snap({
      experimentId: "exp/beta",
      agent: "beta",
      results: [res("algebra/x", "passed", { agent: "beta" })],
    });
    const board = await Scoreboard.data([alpha, beta], {
      rows: "agent",
      subjects: "evalGroup",
      weights: { "algebra/": 3, "algebra/hard/": 9 },
      fullMarks: 100,
    });
    expect(board.dimension).toBe("agent");
    // 生效权重表可审计:最长前缀在前(匹配顺序)
    expect(board.weights).toEqual([
      { prefix: "algebra/hard/", weight: 9 },
      { prefix: "algebra/", weight: 3 },
    ]);

    const alphaRow = board.rows.find((r) => r.key === "alpha")!;
    const betaRow = board.rows.find((r) => r.key === "beta")!;

    // Σ分值 = 3(algebra/x)+ 9(algebra/hard/y,最长前缀 9 不是 3)+ 1(geometry/z,默认)= 13
    expect(alphaRow.total.value).toBeCloseTo(100);
    // beta 只答了 algebra/x:总分 = 100 × 3/13 ≈ 23.1。
    // 若最长前缀错配成 "algebra/" 的 3,分母变 7,会得 100 × 3/7 ≈ 42.9 —— 钉死歧义。
    expect(betaRow.total.value).toBeCloseTo((100 * 3) / 13);

    // 固定分母:beta 没跑的题留在分母,missing 如实报在科目行
    const betaAlgebra = betaRow.subjects.find((s) => s.key === "algebra")!;
    expect(betaAlgebra.possible).toBe(12); // 3 + 9
    expect(betaAlgebra.earned).toBe(3);
    expect(betaAlgebra.evals).toBe(2);
    expect(betaAlgebra.missing).toBe(1);
    const betaGeometry = betaRow.subjects.find((s) => s.key === "geometry")!;
    expect(betaGeometry.possible).toBe(1);
    expect(betaGeometry.earned).toBe(0);
    expect(betaGeometry.missing).toBe(1);

    const alphaAlgebra = alphaRow.subjects.find((s) => s.key === "algebra")!;
    expect(alphaAlgebra.earned).toBe(12);
    expect(alphaAlgebra.missing).toBe(0);
  });

  it("默认 score 是 examScore:soft 分进总分;skipped 算 missing 而非 0 分入账", async () => {
    const solo = snap({
      experimentId: "exp/solo",
      agent: "solo",
      results: [
        res("algebra/x", "passed", { agent: "solo", assertions: [softAssertion("judge", 0.5)] }),
        res("algebra/y", "skipped", { agent: "solo" }), // 无有效样本 → missing(按 0 计但如实标注)
      ],
    });
    const board = await Scoreboard.data([solo], { rows: "agent" });
    const row = board.rows[0];
    // 两题各 1 分:0.5 + 0(missing)→ 100 × 0.5/2 = 25
    expect(row.total.value).toBeCloseTo(25);
    expect(row.subjects[0].missing).toBe(1);
    expect(row.subjects[0].evals).toBe(2);
  });

  it("快照携带的 knownEvalIds 进固定分母(发布目录上的残缺不消失)", async () => {
    const s = snap({
      experimentId: "exp/x",
      agent: "solo",
      results: [res("algebra/x", "passed", { agent: "solo" })],
      knownEvalIds: ["algebra/x", "algebra/y"],
    });
    const board = await Scoreboard.data([s], { rows: "agent" });
    expect(board.rows[0].subjects[0].evals).toBe(2);
    expect(board.rows[0].subjects[0].missing).toBe(1);
    expect(board.rows[0].total.value).toBeCloseTo(50);
  });
});

// ───────────────────────── MetricScatter.data ─────────────────────────

describe("MetricScatter.data", () => {
  it("任一轴 null 的点仍在 rows 里、可数;series 随组解析", async () => {
    const withCost = snap({
      experimentId: "exp/a",
      agent: "a1",
      results: [res("A", "passed", { agent: "a1", usage: { inputTokens: 10, outputTokens: 5, costUSD: 0.5 } })],
    });
    const noCost = snap({
      experimentId: "exp/b",
      agent: "b1",
      results: [res("A", "passed", { agent: "b1" })],
    });
    const data = await MetricScatter.data([withCost, noCost], {
      points: "experiment",
      series: "agent",
      x: costUSD,
      y: passRate,
    });
    expect(data.points).toBe("experiment");
    expect(data.series).toBe("agent");
    expect(data.rows).toHaveLength(2);

    const a = data.rows.find((r) => r.key === "exp/a")!;
    expect(a.series).toBe("a1");
    expect(a.x.value).toBe(0.5);
    expect(a.y.value).toBe(1);

    const b = data.rows.find((r) => r.key === "exp/b")!;
    expect(b.x.value).toBeNull(); // 没有成本数据:点在,值缺
    expect(b.y.value).toBe(1);
    // 注脚「n 个点缺数据」就从 rows 里数出来,不需要另一份数据
    expect(data.rows.filter((r) => r.x.value === null || r.y.value === null)).toHaveLength(1);
  });
});

// ───────────────────────── flag():维度与轴 ─────────────────────────

describe("flag()", () => {
  const withFlags = (id: string, flags: Record<string, unknown> | undefined, verdict: Verdict) =>
    snap({
      experimentId: id,
      results: [res("A", verdict, { experimentId: id, experiment: { id, flags } })],
    });

  it("MetricLine.data:x 收 flag、按 experiment 聚合;未声明的作轴 x=null 报数", async () => {
    const s1 = withFlags("ultra/lat-100", { latencyMs: 100, agents: 1 }, "passed");
    const s2 = withFlags("ultra/lat-300", { latencyMs: 300, agents: 1 }, "failed");
    const legacy = withFlags("ultra/legacy", undefined, "passed");
    const data = await MetricLine.data([s1, s2, legacy], {
      x: flag("latencyMs", { label: "Simulated latency", unit: "ms" }),
      series: flag("agents", { label: (v) => `${v} agents` }),
      y: passRate,
    });
    expect(data.x).toEqual({ key: "latencyMs", label: "Simulated latency", unit: "ms" });
    expect(data.series).toBe("agents");
    expect(data.rows).toHaveLength(3);

    const p100 = data.rows.find((r) => r.key === "ultra/lat-100")!;
    expect(p100.x).toBe(100);
    expect(p100.xDisplay).toBe("100ms");
    expect(p100.series).toBe("1 agents");
    expect(p100.y.value).toBe(1);

    // 未声明 flag 的 experiment 不猜:作轴 x=null(组件不画、注脚报数),分组归 (unset)
    const legacyRow = data.rows.find((r) => r.key === "ultra/legacy")!;
    expect(legacyRow.x).toBeNull();
    expect(legacyRow.xDisplay).toBe("");
    expect(legacyRow.series).toBe("(unset)");
  });

  it("flag 当维度用:按声明值分组,label 函数折组名", async () => {
    const s1 = withFlags("exp/a", { agents: 1 }, "passed");
    const s2 = withFlags("exp/b", { agents: 16 }, "failed");
    const data = await MetricTable.data([s1, s2], {
      rows: flag("agents", { label: (v) => `${v} agents` }),
      columns: [passRate],
    });
    expect(data.dimension).toBe("agents");
    expect(data.rows.map((r) => r.key)).toEqual(["1 agents", "16 agents"]);
  });
});

// ───────────────────────── MetricTable.data · expand 展开 ─────────────────────────

describe("MetricTable.data · expand", () => {
  it("expand: \"eval\":子行按 eval 分组、同一套 columns 重算,verdict/reason/ref/runs 随行", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "passed"),
        res("B", "failed", {
          assertions: [softAssertion("gate-check", 0, { passed: false, severity: "gate", detail: "expected 2, got 1" })],
        }),
      ],
    });
    const data = await MetricTable.data([s], { rows: "experiment", columns: [passRate], expand: "eval" });
    expect(data.rows).toHaveLength(1);
    const subRows = data.rows[0].meta?.subRows;
    expect(subRows).toHaveLength(2);
    // 按 key 字母序(A、B)
    expect(subRows?.map((r) => r.key)).toEqual(["A", "B"]);
    const a = subRows!.find((r) => r.key === "A")!;
    expect(a.verdict).toBe("passed");
    expect(a.reason).toBeUndefined();
    expect(a.runs).toBe(1);
    expect(a.passedRuns).toBe(1);
    // 子行与父行同一套 columns:cells 里有 pass-rate,值口径与父行单独算这道题一致
    expect(a.cells["pass-rate"].value).toBe(1);
    const b = subRows!.find((r) => r.key === "B")!;
    expect(b.verdict).toBe("failed");
    expect(b.reason).toBe("gate-check: expected 2, got 1");
    expect(b.cells["pass-rate"].value).toBe(0);
    // ref 指向这道题的代表 attempt,供渲染面深链
    expect(a.ref.attempt).toBe("A/a0");
    expect(b.ref.attempt).toBe("B/a0");
  });

  it("多轮 attempt 折成一条子行:任一轮通过则 verdict=passed,runs/passedRuns 如实报", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [res("flaky", "failed", { attempt: 0 }), res("flaky", "passed", { attempt: 1 })],
    });
    const data = await MetricTable.data([s], { rows: "experiment", columns: [passRate], expand: "eval" });
    const sub = data.rows[0].meta!.subRows!;
    expect(sub).toHaveLength(1);
    expect(sub[0].key).toBe("flaky");
    expect(sub[0].verdict).toBe("passed"); // 任一轮通过 → 该 eval 通过,对齐 earlyExit 语义
    expect(sub[0].runs).toBe(2);
    expect(sub[0].passedRuns).toBe(1);
  });

  it("不设 expand:meta 没有 subRows 字段(旧调用点行为不变)", async () => {
    const s = snap({ experimentId: "exp/x", results: [res("A", "passed")] });
    const data = await MetricTable.data([s], { rows: "experiment", columns: [passRate] });
    expect(data.rows[0].meta?.subRows).toBeUndefined();
  });

  it("expand 不限于 rows: \"experiment\":任何行维度都能展开子维度", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [res("A", "passed", { agent: "bub" }), res("B", "failed", { agent: "bub" })],
    });
    const data = await MetricTable.data([s], { rows: "agent", columns: [passRate], expand: "eval" });
    expect(data.rows[0].key).toBe("bub");
    expect(data.rows[0].meta?.subRows?.map((r) => r.key)).toEqual(["A", "B"]);
  });

  // ── 原因优先级(docs/reports.md「原因摘要」口径:error → skipReason → 未通过的 gate 断言)──

  it("原因优先级:同一 result 同时含 error、失败 gate、失败 soft → 只显示 error", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "errored", {
          error: "adapter crashed",
          assertions: [
            { name: "includes", severity: "gate", score: 0, passed: false, detail: "missing text" },
            softAssertion("judge", 0.2, { passed: false }),
          ],
        }),
      ],
    });
    const data = await MetricTable.data([s], { rows: "experiment", columns: [passRate], expand: "eval" });
    const sub = data.rows[0].meta!.subRows![0]!;
    expect(sub.reason).toBe("adapter crashed");
  });

  it("skipReason 优先于 gate 断言,但让位给 error", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "skipped", {
          skipReason: "missing fixture",
          assertions: [{ name: "includes", severity: "gate", score: 0, passed: false }],
        }),
      ],
    });
    const data = await MetricTable.data([s], { rows: "experiment", columns: [passRate], expand: "eval" });
    const sub = data.rows[0].meta!.subRows![0]!;
    expect(sub.reason).toBe("missing fixture");
  });

  it("多个失败 gate 按原始声明顺序全部保留,拼接成一行;失败 soft 不出现在 reason 里", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "failed", {
          assertions: [
            softAssertion("judge-first", 0.1, { passed: false }), // 声明顺序第一,但 soft 不进 reason
            { name: "includes", severity: "gate", score: 0, passed: false, detail: "missing text" },
            { name: "matches", severity: "gate", score: 0, passed: false }, // 无 detail,只有 name
            softAssertion("judge-last", 0.3, { passed: false }), // soft 依旧不进 reason
          ],
        }),
      ],
    });
    const data = await MetricTable.data([s], { rows: "experiment", columns: [passRate], expand: "eval" });
    const sub = data.rows[0].meta!.subRows![0]!;
    expect(sub.reason).toBe("includes: missing text, matches");
  });
});

// ───────────────────────── RunOverview.data ─────────────────────────

describe("RunOverview.data", () => {
  it("costUSD 全缺为 null 不编 0;有实测/估算则求和;Snapshot[] 输入无警告", async () => {
    const bare = snap({ experimentId: "exp/x", results: [res("A", "passed"), res("B", "failed")] });
    const bareOverview = await RunOverview.data([bare]);
    expect(bareOverview.totals.costUSD).toBeNull();
    expect(bareOverview.totals.attempts).toBe(2);
    expect(bareOverview.totals.passed).toBe(1);
    expect(bareOverview.totals.failed).toBe(1);
    expect(bareOverview.warnings).toEqual([]);

    const priced = snap({
      experimentId: "exp/y",
      results: [
        res("A", "passed", { estimatedCostUSD: 0.1 }),
        res("B", "passed", { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.2 } }),
      ],
    });
    const data = await RunOverview.data([priced]);
    expect(data.totals.costUSD).toBeCloseTo(0.3);
    expect(data.totals.evals).toBe(2);
    expect(data.snapshots).toEqual([
      { experimentId: "exp/y", agent: "agent-x", model: undefined, startedAt: priced.startedAt },
    ]);
  });

  it("收 Selection 时 warnings 随行进数据 —— 诚实不靠使用者记得透传", async () => {
    const s = snap({ experimentId: "exp/x", results: [res("A", "passed")] });
    const warning: SelectionWarning = {
      kind: "partial-coverage",
      experimentId: "exp/x",
      covered: 1,
      total: 50,
      message: "snapshot covers 1 of 50 evals seen in history",
    };
    const data = await RunOverview.data(selection([s], [warning]));
    expect(data.warnings).toEqual([warning]);
  });
});

// ───────────────────────── GroupSummary.data ─────────────────────────

describe("GroupSummary.data", () => {
  it("多 experiment、多 attempt、部分成本缺失、不同 startedAt:eval 级折叠计票(完整身份键)、总成本 null-safe 求和、lastRunAt 取组内最大值", async () => {
    const expA = snap({
      experimentId: "exp/a",
      runStartedAt: "2026-07-01T08:00:00Z",
      results: [
        // "shared" 两轮:一败一过 → 折叠成 passed(与 exp/b 同名的 "shared" 各算各的,见下方独立测试)
        res("shared", "failed", { attempt: 0 }),
        res("shared", "passed", { attempt: 1, usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.5 } }),
        // "only-a" 只有 exp/a 跑过,失败、没报成本
        res("only-a", "failed"),
      ],
    });
    const expB = snap({
      experimentId: "exp/b",
      runStartedAt: "2026-07-03T08:00:00Z", // 比 exp/a 晚 —— lastRunAt 应取这个
      results: [
        // 与 exp/a 同名的 "shared":不同 experiment,必须独立计一票,不能被误合并
        res("shared", "errored", { estimatedCostUSD: 0.2 }),
      ],
    });

    const data = await GroupSummary.data([expA, expB]);

    expect(data.experiments).toBe(2);
    // 3 道题:exp/a 的 shared、exp/a 的 only-a、exp/b 的 shared —— 完整身份键各算各的
    expect(data.evals).toBe(3);
    expect(data.attempts).toBe(4); // 原始 attempt 计数:exp/a 2(shared)+1(only-a)+ exp/b 1(shared)
    expect(data.verdicts).toEqual({ passed: 1, failed: 1, errored: 1, skipped: 0 });
    // eval 级折叠通过率:1 / (1 + 1 + 1) = 1/3,不是 attempt 原始占比(1 passed / 4 attempts = 25%)
    expect(data.passRate.value).toBeCloseTo(1 / 3, 10);
    expect(data.passRate.display).toBe("33.3%");
    expect(data.passRate.samples).toBe(3);
    expect(data.passRate.total).toBe(3);
    // 总成本 null-safe 求和:0.5(实测)+ 0.2(估算)= 0.7;only-a 的失败 attempt 没报成本,不计 0
    expect(data.totalCostUSD).toBeCloseTo(0.7, 10);
    // 最后运行时间:组内两个快照的 startedAt 取最大值(exp/b 更晚)
    expect(data.lastRunAt).toBe(expB.startedAt);
  });

  it('跨 experiment 同名 eval 不合并:两个 experiment 各自的 "x" 独立计一票,不是被折成一票', async () => {
    const a = snap({ experimentId: "exp/a", results: [res("x", "passed")] });
    const b = snap({ experimentId: "exp/b", results: [res("x", "failed")] });
    const data = await GroupSummary.data([a, b]);
    expect(data.experiments).toBe(2);
    expect(data.evals).toBe(2); // 只按 eval id 折叠(误把两个 experiment 的 "x" 当一道题)会变成 1
    expect(data.verdicts).toEqual({ passed: 1, failed: 1, errored: 0, skipped: 0 });
    expect(data.passRate.value).toBeCloseTo(0.5, 10); // 误合并会因为「任一轮过即过」变成 100%
  });

  it("全组没有任何 attempt 报成本 → totalCostUSD null,不编 0", async () => {
    const s = snap({ experimentId: "exp/x", results: [res("A", "passed"), res("B", "failed")] });
    const data = await GroupSummary.data([s]);
    expect(data.totalCostUSD).toBeNull();
  });

  it("分母为 0(组内 eval 全部 skipped)→ passRate.value 为 null,不编 0%", async () => {
    const s = snap({ experimentId: "exp/x", results: [res("A", "skipped"), res("B", "skipped")] });
    const data = await GroupSummary.data([s]);
    expect(data.verdicts).toEqual({ passed: 0, failed: 0, errored: 0, skipped: 2 });
    expect(data.passRate.value).toBeNull();
    expect(data.passRate.display).toBe("—");
    expect(data.passRate.samples).toBe(0);
    expect(data.passRate.total).toBe(2);
  });

  it("lastRunAt 只从传入的组 Selection 取值,不读全局最新 —— 组外快照更晚也不影响", async () => {
    const inGroup = snap({
      experimentId: "exp/a",
      runStartedAt: "2026-07-01T08:00:00Z",
      results: [res("A", "passed")],
    });
    const outOfGroup = snap({
      experimentId: "exp/b",
      runStartedAt: "2026-07-09T08:00:00Z",
      results: [res("B", "passed")],
    });
    const sel = selection([inGroup, outOfGroup], []);
    const scoped = sel.filter((s) => s.experimentId === "exp/a"); // 只留组内快照,模拟 defaultReport 的组 Selection
    const data = await GroupSummary.data(scoped);
    expect(data.lastRunAt).toBe(inGroup.startedAt);
    expect(data.lastRunAt).not.toBe(outOfGroup.startedAt);
  });

  it('MetricTable rows: "experiment" 的 verdicts meta 复用同一份 eval 级统计,行为不变(回归)', async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [res("A", "passed", { attempt: 0 }), res("A", "failed", { attempt: 1 }), res("B", "failed")],
    });
    const data = await MetricTable.data([s], { rows: "experiment", columns: [passRate] });
    // A 两轮折成 passed(任一轮过即过),B 失败:1 passed / 1 failed
    expect(data.rows[0].meta?.verdicts).toEqual({ passed: 1, failed: 1, errored: 0, skipped: 0 });
  });
});

// ───────────────────────── DeltaTable.data ─────────────────────────

describe("DeltaTable.data", () => {
  it("任一侧 null → delta null 不硬算;双侧有值给带符号 display;Δ=0 是 ±0", async () => {
    const base = snap({
      experimentId: "exp/base",
      results: [res("A", "failed"), res("B", "passed", { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.2 } })],
    });
    const plus = snap({
      experimentId: "exp/plus",
      results: [res("A", "passed"), res("B", "passed")], // 无任何成本数据
    });
    const data = await DeltaTable.data([base, plus], {
      pairs: [{ a: "exp/base", b: "exp/plus", label: "memory" }],
      metrics: [passRate, costUSD],
    });
    expect(data.rows).toHaveLength(1);
    const row = data.rows[0];
    expect(row.key).toBe("memory");
    expect(row.a).toEqual({ experimentId: "exp/base" });
    expect(row.b).toEqual({ experimentId: "exp/plus" });

    const pass = row.cells["pass-rate"];
    expect(pass.a.value).toBe(0.5);
    expect(pass.b.value).toBe(1);
    expect(pass.delta).toBeCloseTo(0.5);
    expect(pass.display).toBe("+50%");

    const cost = row.cells["cost"];
    expect(cost.a.value).toBeCloseTo(0.2);
    expect(cost.b.value).toBeNull();
    expect(cost.delta).toBeNull(); // 单侧缺数据:不硬算
    expect(cost.display).toBe("—");

    const flat = await DeltaTable.data([base, base], {
      pairs: [{ a: "exp/base", b: "exp/base", label: "same" }],
      metrics: [passRate],
    });
    expect(flat.rows[0].cells["pass-rate"].display).toBe("±0");
  });

  it("时间轴对比:pairs 的 a/b 收快照键 <experimentId> @ <startedAt>", async () => {
    const older = snap({
      experimentId: "exp/x",
      runStartedAt: "2026-07-01T08:00:00Z",
      results: [res("A", "failed")],
    });
    const newer = snap({
      experimentId: "exp/x",
      runStartedAt: "2026-07-02T08:00:00Z",
      results: [res("A", "passed")],
    });
    const data = await DeltaTable.data([older, newer], {
      pairs: [
        {
          a: "exp/x @ 2026-07-01T08:00:00Z",
          b: "exp/x @ 2026-07-02T08:00:00Z",
          label: "this week vs last",
        },
      ],
      metrics: [passRate],
    });
    const cell = data.rows[0].cells["pass-rate"];
    expect(cell.a.value).toBe(0); // 旧快照那份
    expect(cell.b.value).toBe(1); // 新快照那份
    expect(cell.display).toBe("+100%");
  });
});

// ───────────────────────── CaseList.data ─────────────────────────

describe("CaseList.data", () => {
  it("默认只列 failed+errored;redact 作用于 error/detail/evidence;truncated 如实", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "failed", {
          assertions: [
            {
              name: "includes",
              severity: "gate",
              score: 0,
              passed: false,
              detail: "missing text under /Users/me/repo/src",
              evidence: "checked /Users/me/repo/src/app.ts",
            },
            { name: "ok", severity: "gate", score: 1, passed: true }, // 通过的断言不列
          ],
        }),
        res("B", "errored", { error: "ENOENT /Users/me/repo/tool" }),
        res("C", "failed"),
        res("D", "passed"),
        res("E", "skipped"),
      ],
    });
    const data = await CaseList.data([s], {
      limit: 2,
      redact: (text) => text.replaceAll("/Users/me/repo", "<repo>"),
    });
    expect(data.rows).toHaveLength(2);
    expect(data.truncated).toBe(1); // C 被截;D/E 本就不在默认 verdicts 里

    const [first, second] = data.rows;
    expect(first.eval).toBe("A");
    expect(first.verdict).toBe("failed");
    expect(first.failedAssertions).toHaveLength(1);
    expect(first.failedAssertions[0].detail).toBe("missing text under <repo>/src");
    expect(first.failedAssertions[0].evidence).toBe("checked <repo>/src/app.ts");
    expect(first.ref.attempt).toBe("A/a0");

    expect(second.eval).toBe("B");
    expect(second.verdict).toBe("errored");
    expect(second.error).toBe("ENOENT <repo>/tool");
    expect(second.ref.attempt).toBe("B/a0");
  });

  it("verdicts 可收窄;不传 limit 不截断", async () => {
    const s = snap({ experimentId: "exp/x", results: [res("A", "failed"), res("B", "errored")] });
    const onlyErrored = await CaseList.data([s], { verdicts: ["errored"] });
    expect(onlyErrored.rows.map((r) => r.eval)).toEqual(["B"]);
    expect(onlyErrored.truncated).toBe(0);
  });

  it("failedAssertions 只列未通过的 gate 断言;失败 soft 不算「为什么失败」,与 MetricTable expand 同一套材料", async () => {
    const s = snap({
      experimentId: "exp/x",
      results: [
        res("A", "failed", {
          assertions: [
            { name: "includes", severity: "gate", score: 0, passed: false, detail: "missing text" },
            softAssertion("judge", 0.2, { passed: false }), // soft 失败:不算失败原因,只影响得分
          ],
        }),
      ],
    });
    const data = await CaseList.data([s]);
    expect(data.rows[0].failedAssertions).toHaveLength(1);
    expect(data.rows[0].failedAssertions[0].name).toBe("includes");
  });
});

// ───────────────────────── 身份键去重 ─────────────────────────

describe("身份键去重", () => {
  it("同 (experimentId, evalId, attempt, startedAt) 两份 → 保留最新 run 的那份", async () => {
    const identity = {
      experimentId: "exp/x",
      attempt: 0,
      startedAt: "2026-07-01T08:00:00Z",
    };
    // --resume 场景:旧 run 里 failed,新 run 合入同身份键的 passed
    const older = snap({
      experimentId: "exp/x",
      runStartedAt: "2026-07-01T08:00:00Z",
      results: [res("A", "failed", identity)],
    });
    const newer = snap({
      experimentId: "exp/x",
      runStartedAt: "2026-07-02T08:00:00Z",
      results: [res("A", "passed", identity)],
    });

    for (const order of [
      [older, newer],
      [newer, older],
    ]) {
      const data = await MetricTable.data(order, { rows: "agent", columns: [passRate] });
      const cell = data.rows[0].cells["pass-rate"];
      expect(cell.total).toBe(1); // 两份只算一份
      expect(cell.value).toBe(1); // 留的是最新 run 里的 passed,与快照传入顺序无关

      const ov = await RunOverview.data(order);
      expect(ov.totals.attempts).toBe(1);
      expect(ov.totals.passed).toBe(1);
      expect(ov.totals.failed).toBe(0);
    }
  });

  it("startedAt 缺失:不去重、如实保留重复,不透出警告", async () => {
    const identity = { experimentId: "exp/x", attempt: 0, startedAt: undefined };
    const one = snap({ experimentId: "exp/x", results: [res("A", "passed", identity)] });
    const two = snap({ experimentId: "exp/x", results: [res("A", "passed", identity)] });
    const ov = await RunOverview.data([one, two]);
    expect(ov.totals.attempts).toBe(2);
    expect(ov.warnings).toEqual([]); // missing-startedAt 不透出到组件数据(裁决记录 7)
  });
});

// ───────────────────────── 格式化 ─────────────────────────

describe("unit 驱动格式化", () => {
  it('"%" / "ms" / "$" / 其余缩写', () => {
    expect(formatMetricValue(0.87, "%")).toBe("87%");
    expect(formatMetricValue(0.875, "%")).toBe("87.5%");
    expect(formatMetricValue(-0.008, "%")).toBe("-0.8%");
    expect(formatMetricValue(850, "ms")).toBe("850ms");
    expect(formatMetricValue(1234, "ms")).toBe("1.2s");
    expect(formatMetricValue(125_000, "ms")).toBe("2m 5s");
    expect(formatMetricValue(0.31, "$")).toBe("$0.31");
    expect(formatMetricValue(0.0042, "$")).toBe("$0.0042");
    expect(formatMetricValue(-0.8, "$")).toBe("-$0.80");
    expect(formatMetricValue(1234, "lines")).toBe("1.2k lines");
    expect(formatMetricValue(3_400_000, "tokens")).toBe("3.4M tokens");
    expect(formatMetricValue(42)).toBe("42");
  });

  it("metric.display 覆盖内置格式化", async () => {
    const raw = defineMetric({
      name: "raw",
      unit: "%",
      display: (v) => `${v} raw`,
      value: () => 0.5,
    });
    const s = snap({ experimentId: "exp/x", results: [res("A", "passed")] });
    const data = await MetricTable.data([s], { rows: "agent", columns: [raw] });
    expect(data.rows[0].cells["raw"].display).toBe("0.5 raw");
  });
});

// ───────────────────────── MetricMatrix.data(= MetricBars.data)─────────────────────────

describe("MetricMatrix.data", () => {
  it("稀疏:没有 attempt 的 (row, column) 组合不出格", async () => {
    const a = snap({
      experimentId: "exp/a",
      agent: "a1",
      results: [res("A", "passed", { agent: "a1" }), res("B", "failed", { agent: "a1" })],
    });
    const b = snap({
      experimentId: "exp/b",
      agent: "b1",
      results: [res("A", "failed", { agent: "b1" })], // b1 没跑 B
    });
    const data = await MetricMatrix.data([a, b], { rows: "eval", columns: "agent", cell: passRate });
    expect(data.rows).toBe("eval");
    expect(data.columns).toBe("agent");
    expect(data.metric.key).toBe("pass-rate");
    expect(data.cells).toHaveLength(3); // A×a1、B×a1、A×b1;B×b1 不出现
    const find = (row: string, column: string) => data.cells.find((c) => c.row === row && c.column === column);
    expect(find("A", "a1")?.cell.value).toBe(1);
    expect(find("B", "a1")?.cell.value).toBe(0);
    expect(find("A", "b1")?.cell.value).toBe(0);
    expect(find("B", "b1")).toBeUndefined();
  });

  it("MetricBars.data 就是 MetricMatrix.data 的别名(同一个函数)", () => {
    expect(MetricBars.data).toBe(MetricMatrix.data);
  });
});
