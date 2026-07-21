// cases: docs/engineering/testing/unit/results.md
// show / view 两宿主的 Scope 选择等价契约(docs/feature/results/architecture.md「Selection 是计算入口」;
// docs/feature/results/library.md「选择快照」)。
//
// 守护的不变量:同一结果根、同一组范围参数下,两扇门(niceeval show 的 text 面、niceeval view 的
// web 面)传给 selectCurrentResults(results, scope) 同形的 scope({ experiment, patterns }),必须
// 算出同一份现刻水位 Selection —— 归一化后的 experiment 集 / 每 experiment 的 eval 集 / 每 eval 的
// attempt 原始身份(经 AttemptRef.snapshot + attempt)/ warnings 的 kind 与结构字段全部深等。
//
// 这是最直接的契约对象:两个宿主都调这一个函数、传同形状的 scope,它对了两扇门就对——不需要真的
// 起 show / view 两条渲染路径去比较文案。渲染出的终端文案与 HTML 不在本层断言,归
// docs/engineering/testing/e2e/report.md 的读面 CLI 行为(§4)与渲染面(§5)验收。
//
// fixture 直接写新布局(<expDir>/<snapDir>/snapshot.json + <evalId>/a<n>/result.json),
// 依据 docs/feature/results/architecture.md 的稳定磁盘契约(与 show.test.ts / view/data.test.ts 同一写法)。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openResults } from "./index.ts";
import type { Scope, ScopeWarning } from "./index.ts";
import { selectCurrentResults, type ResultScope } from "./select.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type Verdict } from "../types.ts";

// ───────────────────────── fixture 工具 ─────────────────────────

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-equiv-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

type AttemptFixture = Pick<EvalResult, "id" | "verdict"> &
  Partial<Pick<EvalResult, "attempt" | "durationMs" | "assertions" | "estimatedCostUSD" | "usage" | "startedAt" | "artifactBase" | "hasEvents">>;

function res(id: string, verdict: Verdict, extra: Partial<AttemptFixture> = {}): AttemptFixture {
  return { id, verdict, attempt: 0, durationMs: 1000, assertions: [], ...extra };
}

/** 实验目录名清洗:与 docs/feature/results/architecture.md 一致(/ 与非 [\w.@-] 换成 _)。 */
function cleanDirName(id: string): string {
  return id.replace(/[^\w.@-]/g, "_");
}

interface SnapshotOpts {
  experimentId: string;
  agent?: string;
  model?: string;
  startedAt: string;
  /** 缺省 = 已收尾(completedAt = startedAt);置 true 则不写 completedAt,模拟中断快照。 */
  unfinished?: boolean;
  knownEvalIds?: string[];
  /** 声明这份快照实际选中的 eval id 全集;省略 = 第三方 harness 未实现该字段。 */
  selectedEvalIds?: string[];
}

/** 写一份新布局快照:snapshot.json + 各 attempt 的 result.json。返回快照目录绝对路径。 */
async function writeSnapshot(
  root: string,
  snapDirName: string,
  opts: SnapshotOpts,
  results: AttemptFixture[],
): Promise<string> {
  const dir = join(root, cleanDirName(opts.experimentId), snapDirName);
  await mkdir(dir, { recursive: true });
  const meta = {
    format: RESULTS_FORMAT,
    schemaVersion: RESULTS_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.4.6" },
    experimentId: opts.experimentId,
    agent: opts.agent ?? "bub",
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    startedAt: opts.startedAt,
    ...(opts.unfinished ? {} : { completedAt: opts.startedAt }),
    ...(opts.knownEvalIds ? { knownEvalIds: opts.knownEvalIds } : {}),
    ...(opts.selectedEvalIds !== undefined
      ? { experiment: { runs: 1, earlyExit: true, selectedEvalIds: opts.selectedEvalIds } }
      : {}),
  };
  await writeFile(join(dir, "snapshot.json"), JSON.stringify(meta, null, 2), "utf-8");
  for (const r of results) {
    const attemptDir = join(dir, r.id, `a${r.attempt ?? 0}`);
    await mkdir(attemptDir, { recursive: true });
    await writeFile(join(attemptDir, "result.json"), JSON.stringify(r, null, 2), "utf-8");
  }
  return dir;
}

// ───────────────────────── Selection 身份归一化 helper(测试专用) ─────────────────────────
//
// 生产逻辑保证的稳定顺序原样保留(evals 已按 id 排序、attempts 按 a<n> 读入顺序);helper 不再排序,
// 以免掩盖生产代码可能的不确定顺序。时间 / 成本 / verdict 保留真值;宿主机绝对路径(unfinished
// 警告的 dir、快照 dir)不进归一化结果 —— attempt 身份一律走 AttemptRef.snapshot + attempt(根相对)。

interface NormAttempt {
  snapshot: string;
  attempt: string;
  verdict: Verdict;
}
interface NormEval {
  evalId: string;
  attempts: NormAttempt[];
}
interface NormExperiment {
  experimentId: string;
  evals: NormEval[];
}
type NormWarning =
  | { kind: "partial-coverage"; experimentId: string; covered: number; total: number }
  | { kind: "stale-snapshot"; experimentId: string; startedAt: string; latestStartedAt: string }
  | { kind: "unfinished-snapshot"; experimentId: string; startedAt: string }
  | { kind: "unreadable-snapshot"; reason: string };
interface NormSelection {
  warnings: NormWarning[];
  experiments: NormExperiment[];
}

function normalizeWarning(w: ScopeWarning): NormWarning {
  switch (w.kind) {
    case "partial-coverage":
      return { kind: w.kind, experimentId: w.experimentId, covered: w.covered, total: w.total };
    case "stale-snapshot":
      return { kind: w.kind, experimentId: w.experimentId, startedAt: w.startedAt, latestStartedAt: w.latestStartedAt };
    case "unfinished-snapshot":
      // dir 是宿主机绝对路径,归一化掉;身份靠 experimentId + startedAt。
      return { kind: w.kind, experimentId: w.experimentId, startedAt: w.startedAt };
    case "unreadable-snapshot":
      // dir 是宿主机绝对路径,归一化掉;这个 kind 本就非实验作用域,没有 experimentId 可比。
      return { kind: w.kind, reason: w.reason };
  }
}

function normalizeSelection(selection: Scope): NormSelection {
  return {
    warnings: selection.warnings.map(normalizeWarning),
    experiments: selection.snapshots.map((snapshot) => ({
      experimentId: snapshot.experimentId,
      evals: snapshot.evals.map((ev) => ({
        evalId: ev.id,
        attempts: ev.attempts.map((a) => ({
          snapshot: a.ref.snapshot,
          attempt: a.ref.attempt,
          verdict: a.result.verdict,
        })),
      })),
    })),
  };
}

/** 两个宿主构造给选择器的 scope 完全同形:验证读源无误,避免"我以为它们一样"。 */
function hostScope(patterns: string[], experiment?: string): ResultScope {
  return { experiment, patterns };
}

/** 周一全量(q1 通过、q2 失败)+ 周二只补跑 q1(仍通过):现刻水位 = q1 周二 + q2 周一,50%。 */
async function seedPartialRerun(): Promise<string> {
  const root = await makeRoot();
  await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
    res("q1", "passed"),
    res("q2", "failed", { assertions: [{ name: 'fileChanged("q2.tsx")', severity: "gate", score: 0, outcome: "failed" as const, detail: "file was not modified" }] }),
  ]);
  await writeSnapshot(root, "2026-07-02T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
    res("q1", "passed"),
  ]);
  return root;
}

// ══════════════════════════════════════════════════════════════════════════
// selectCurrentResults · 现刻水位结构化身份(11 必测场景中的选择器可判定部分)
// ══════════════════════════════════════════════════════════════════════════

describe("selectCurrentResults · 现刻水位结构化身份", () => {
  it("场景1 单 experiment / 单快照 / 单 attempt", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T00-00-00-000Z", { experimentId: "solo/bub", startedAt: "2026-07-01T00:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    const results = await openResults(root);
    expect(normalizeSelection(selectCurrentResults(results))).toEqual({
      warnings: [],
      experiments: [
        {
          experimentId: "solo/bub",
          evals: [{ evalId: "q1", attempts: [{ snapshot: "solo_bub/2026-07-01T00-00-00-000Z", attempt: "q1/a0", verdict: "passed" }] }],
        },
      ],
    } satisfies NormSelection);
  });

  it("场景2 全量快照后局部补跑一个 eval:q1 取周二、q2 从周一补齐,无伪残缺", async () => {
    const root = await seedPartialRerun();
    const results = await openResults(root);
    expect(normalizeSelection(selectCurrentResults(results))).toEqual({
      warnings: [],
      experiments: [
        {
          experimentId: "compare/bub",
          evals: [
            // q1 来自周二快照(局部补跑),q2 来自周一全量快照(补齐)—— 深链各指各的物理 run。
            { evalId: "q1", attempts: [{ snapshot: "compare_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "passed" }] },
            { evalId: "q2", attempts: [{ snapshot: "compare_bub/2026-07-01T08-00-00-000Z", attempt: "q2/a0", verdict: "failed" }] },
          ],
        },
      ],
    } satisfies NormSelection);
    // 对照:results.latest() 只挑周二快照,是残缺的(这正是宿主要合成现刻水位的原因)。
    expect(results.latest().warnings.some((w) => w.kind === "partial-coverage")).toBe(true);
  });

  it("合成快照的 selectedEvalIds 重建为最终 picks(q1 新快照 + q2 旧快照补齐),不是照抄某一来源的局部选择", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "compare/carry", startedAt: "2026-07-01T08:00:00.000Z", selectedEvalIds: ["q1", "q2"] },
      [res("q1", "passed"), res("q2", "failed")],
    );
    await writeSnapshot(
      root,
      "2026-07-02T08-00-00-000Z",
      { experimentId: "compare/carry", startedAt: "2026-07-02T08:00:00.000Z", selectedEvalIds: ["q1"] },
      [res("q1", "passed")],
    );
    const results = await openResults(root);
    const scope = selectCurrentResults(results);
    expect(scope.snapshots[0]!.experiment!.selectedEvalIds).toEqual(["q1", "q2"]);
  });

  it("来源快照声明 selectedEvalIds:[q1] 却夹带 q2 的历史 attempt,合成结果不含该 q2", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "compare/leaky", startedAt: "2026-07-01T08:00:00.000Z", selectedEvalIds: ["q1"] },
      [res("q1", "passed"), res("q2", "passed")], // q2 落盘了,但没被这次实验选中
    );
    const results = await openResults(root);
    const scope = selectCurrentResults(results);
    expect(scope.snapshots[0]!.evals.map((ev) => ev.id)).toEqual(["q1"]);
  });

  it("第三方快照缺 experiment.selectedEvalIds 时按其实际 evals 退化,不整份排除;与本方快照混合时各自按自己口径收窄", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "third-party/harness", startedAt: "2026-07-01T08:00:00.000Z" }, // 无 selectedEvalIds
      [res("q1", "passed"), res("q2", "passed")],
    );
    const results = await openResults(root);
    const scope = selectCurrentResults(results);
    expect(scope.snapshots[0]!.evals.map((ev) => ev.id).sort()).toEqual(["q1", "q2"]);
  });

  it("场景3 同一 eval 多 attempts:最新快照整批替换旧 attempts,不跨快照混装", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "retry/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "passed", { attempt: 0 }),
    ]);
    await writeSnapshot(root, "2026-07-02T08-00-00-000Z", { experimentId: "retry/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
      res("q1", "failed", { attempt: 0 }),
      res("q1", "passed", { attempt: 1 }),
    ]);
    const results = await openResults(root);
    const norm = normalizeSelection(selectCurrentResults(results));
    // q1 整批取自周二(两个 attempt 都在周二快照),周一的那次 attempt 不掺进来。
    expect(norm.experiments[0].evals).toEqual([
      {
        evalId: "q1",
        attempts: [
          { snapshot: "retry_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "failed" },
          { snapshot: "retry_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a1", verdict: "passed" },
        ],
      },
    ] satisfies NormEval[]);
    expect(norm.warnings).toEqual([]);
  });

  it("场景4 多 experiment 更新时间不同:较早的实验触发 stale-snapshot", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    await writeSnapshot(root, "2026-07-03T08-00-00-000Z", { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-03T08:00:00.000Z" }, [
      res("q1", "passed"),
    ]);
    const results = await openResults(root);
    const norm = normalizeSelection(selectCurrentResults(results));
    expect(norm.warnings).toEqual([
      { kind: "stale-snapshot", experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z", latestStartedAt: "2026-07-03T08:00:00.000Z" },
    ] satisfies NormWarning[]);
    expect(norm.experiments.map((e) => e.experimentId)).toEqual(["compare/bub", "compare/codex"]);
  });

  it("场景5 未完成快照(无 completedAt):触发 unfinished-snapshot", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T00-00-00-000Z", { experimentId: "solo/bub", startedAt: "2026-07-01T00:00:00.000Z", unfinished: true }, [
      res("q1", "passed"),
    ]);
    const results = await openResults(root);
    expect(normalizeSelection(selectCurrentResults(results)).warnings).toEqual([
      { kind: "unfinished-snapshot", experimentId: "solo/bub", startedAt: "2026-07-01T00:00:00.000Z" },
    ] satisfies NormWarning[]);
  });

  it("场景6 历史已知 eval 从未有可读结果:触发真实 partial-coverage", async () => {
    const root = await makeRoot();
    // knownEvalIds 声明 q1 与 q2,但 q2 从未落盘 —— 跨快照补齐后仍缺,这是真残缺。
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z", knownEvalIds: ["q1", "q2"] },
      [res("q1", "passed")],
    );
    const results = await openResults(root);
    const norm = normalizeSelection(selectCurrentResults(results));
    expect(norm.experiments[0].evals.map((e) => e.evalId)).toEqual(["q1"]);
    expect(norm.warnings).toEqual([
      { kind: "partial-coverage", experimentId: "compare/bub", covered: 1, total: 2 },
    ] satisfies NormWarning[]);
  });

  it("场景7 eval id 前缀过滤:覆盖分母同步收窄到范围内", async () => {
    const root = await makeRoot();
    await writeSnapshot(
      root,
      "2026-07-01T08-00-00-000Z",
      {
        experimentId: "compare/bub",
        startedAt: "2026-07-01T08:00:00.000Z",
        // 已知并集:weather 两题 + 一道范围外的 algebra。
        knownEvalIds: ["weather/brooklyn", "weather/queens", "algebra/quadratic"],
      },
      [res("weather/brooklyn", "passed"), res("algebra/quadratic", "passed")],
    );
    const results = await openResults(root);

    const weather = normalizeSelection(selectCurrentResults(results, hostScope(["weather"])));
    expect(weather.experiments[0].evals.map((e) => e.evalId)).toEqual(["weather/brooklyn"]);
    // 分母 = {weather/brooklyn, weather/queens} ∩ 范围 = 2,缺 queens → 1/2;algebra 的缺口不进来。
    expect(weather.warnings).toEqual([
      { kind: "partial-coverage", experimentId: "compare/bub", covered: 1, total: 2 },
    ] satisfies NormWarning[]);

    // algebra 范围:该题有结果,范围内无缺口 → 不刷 weather 的残缺屏。
    const algebra = normalizeSelection(selectCurrentResults(results, hostScope(["algebra"])));
    expect(algebra.warnings).toEqual([]);
  });

  it("场景8 --exp 分段前缀过滤:只留匹配段,不误配同前缀实验", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [res("q1", "passed")]);
    await writeSnapshot(root, "2026-07-01T09-00-00-000Z", { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-01T09:00:00.000Z" }, [res("q1", "passed")]);
    await writeSnapshot(root, "2026-07-01T10-00-00-000Z", { experimentId: "solo/bub", startedAt: "2026-07-01T10:00:00.000Z" }, [res("q1", "passed")]);
    const results = await openResults(root);
    const norm = normalizeSelection(selectCurrentResults(results, hostScope([], "compare")));
    // "compare" 分段前缀匹配 compare/bub、compare/codex,不含 solo/bub。
    expect(norm.experiments.map((e) => e.experimentId)).toEqual(["compare/bub", "compare/codex"]);
  });

  it("场景9 --run 指向单个结果根:选择器只看该根的实验,不串到另一个根", async () => {
    const rootA = await makeRoot();
    const rootB = await makeRoot();
    await writeSnapshot(rootA, "2026-07-01T08-00-00-000Z", { experimentId: "onlyA/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [res("qa", "passed")]);
    await writeSnapshot(rootB, "2026-07-02T08-00-00-000Z", { experimentId: "onlyB/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [res("qb", "passed")]);
    const normA = normalizeSelection(selectCurrentResults(await openResults(rootA)));
    const normB = normalizeSelection(selectCurrentResults(await openResults(rootB)));
    // 各根只看见自己的实验;show --run rootB / view rootB 传的都是同一个 root 参数,
    // 不会把另一个根的 experiment 混进来 —— 隔离性在选择入口这一层就成立。
    expect(normA.experiments.map((e) => e.experimentId)).toEqual(["onlyA/bub"]);
    expect(normB.experiments.map((e) => e.experimentId)).toEqual(["onlyB/bub"]);
  });

  it("场景11 resume 携带的复印件不重复计票,证据 ref 仍指向可读 artifact", async () => {
    const root = await makeRoot();
    // 周一原始:q1 通过,带 events artifact。
    const oldDir = await writeSnapshot(root, "2026-07-01T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-01T08:00:00.000Z" }, [
      res("q1", "passed", { hasEvents: true }),
    ]);
    await writeFile(join(oldDir, "q1", "a0", "events.json"), "[]", "utf-8");
    // 周二 resume:q1 是复印件(startedAt 锚原快照,artifactBase 指原快照 artifact),q2 是新题。
    await writeSnapshot(root, "2026-07-02T08-00-00-000Z", { experimentId: "compare/bub", startedAt: "2026-07-02T08:00:00.000Z" }, [
      res("q1", "passed", { hasEvents: true, startedAt: "2026-07-01T08:00:00.000Z", artifactBase: "compare_bub/2026-07-01T08-00-00-000Z/q1/a0" }),
      res("q2", "passed"),
    ]);
    const results = await openResults(root);
    const selection = selectCurrentResults(results);
    const norm = normalizeSelection(selection);
    // q1 整批取自周二(含它的最新快照 = 复印件那份),只出现一次;不因为它也活在周一而计两票。
    expect(norm.experiments[0].evals).toEqual([
      { evalId: "q1", attempts: [{ snapshot: "compare_bub/2026-07-02T08-00-00-000Z", attempt: "q1/a0", verdict: "passed" }] },
      { evalId: "q2", attempts: [{ snapshot: "compare_bub/2026-07-02T08-00-00-000Z", attempt: "q2/a0", verdict: "passed" }] },
    ] satisfies NormEval[]);
    expect(norm.warnings).toEqual([]);
    // 证据 ref 可达:复印件的 artifactBase 回退到原快照,events.json 仍读得到(非 null)。
    const q1 = selection.snapshots[0].evals.find((e) => e.id === "q1")!;
    expect(await q1.attempts[0].events()).not.toBeNull();
  });
});
