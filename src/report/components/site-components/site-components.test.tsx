// cases: docs/engineering/testing/unit/reports.md
// 站点组件的单元测试:Hero 的标题回退链与显式覆盖(resolve 后的 props,不经渲染)、Hero 与手写
// HeroCard 组合的结构严格等价、heroData(latestStartedAt / snapshots)、groupScopeWarnings(按动作
// 聚合的纯函数:组构成、排序、命令去重、summary 与 detailsOpen 阈值,web/text 两面共用同一份计算)、
// scopeWarningsData(裸 Snapshot[] 输入的空数组语义)、copyFixPromptData(prompt 内容与 failures 计数)、
// traceWaterfallData(顶层 span 摘要、排序、trace 缺失语义、runner phases 不进瀑布)。观察面全部是
// *Data 计算结果、聚合函数的返回对象与 resolve 后的树节点类型/props;不构造渲染产物——PoweredBy 的
// 品牌行 HTML、ScopeWarnings/CopyFixPrompt/TraceWaterfall 的 DOM 与终端排版、AttemptList filter 的
// 渐进增强markup 不变量,均归 E2E 报告域(docs/engineering/testing/e2e/report.md §5)。

import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, TraceSpan, Verdict } from "../../../types.ts";
import type { AttemptHandle, Results, Scope, ScopeWarning, Snapshot } from "../../../results/index.ts";
import { makeScope } from "../../../results/select.ts";
import { defineComponent, resolveReportTree, ResolveMemo, type ReportNode } from "../../definition/tree.ts";
import { buildReportMeta, defineReport, type ReportDefinition } from "../../definition/report.ts";
import { pickReportPage, reportTitleText } from "../../runtime/text.ts";
import { Hero, HeroCard } from "./index.tsx";
import { copyFixPromptData, heroData, scopeWarningsData, traceWaterfallData } from "./compute.ts";
import { groupScopeWarnings } from "./scope-warnings.ts";

// ───────────────────────── fake 数据(按 results 读取契约造)─────────────────────────

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

let runSeq = 0;

/** 最小快照构造;traces 按 eval id 提供 trace artifact(缺省 null,与真实懒加载语义一致)。 */
function snap(spec: {
  experimentId: string;
  results: EvalResult[];
  name?: Snapshot["name"];
  runStartedAt?: string;
  traces?: Record<string, TraceSpan[]>;
}): Snapshot {
  runSeq += 1;
  const startedAt = spec.runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const snapshot = {
    experimentId: spec.experimentId,
    startedAt,
    completedAt: startedAt,
    agent: "agent-x",
    name: spec.name,
    schemaVersion: 1,
    dir: `/results/exp/snap-${runSeq}`,
  } as Snapshot;
  const attempts: AttemptHandle[] = spec.results.map((r) => ({
    evalId: r.id,
    experimentId: spec.experimentId,
    result: r,
    ref: { snapshot: `exp/snap-${runSeq}`, attempt: `${r.id}/a${r.attempt}` },
    snapshot,
    carried: Boolean(r.artifactBase),
    events: async () => null,
    trace: async () => spec.traces?.[r.id] ?? null,
    o11y: async () => null,
    agentSetup: async () => null,
    diff: async () => null,
    sources: async () => null,
  }));
  const evals = new Map<string, AttemptHandle[]>();
  for (const attempt of attempts) evals.set(attempt.evalId, [...(evals.get(attempt.evalId) ?? []), attempt]);
  snapshot.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  snapshot.attempts = attempts;
  return snapshot;
}

function scopeOf(snapshots: Snapshot[], warnings: ScopeWarning[] = []): Scope {
  return makeScope("current-evals", snapshots, snapshots.flatMap((s) => s.attempts), warnings);
}

function resultsOf(snapshots: Snapshot[]): Results {
  const byId = new Map<string, Snapshot[]>();
  for (const s of snapshots) byId.set(s.experimentId, [...(byId.get(s.experimentId) ?? []), s]);
  const experiments = [...byId.entries()].map(([id, snaps]) => {
    const sorted = [...snaps].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return {
      id,
      snapshots: sorted,
      latest: sorted[0]!,
      evalIds: [...new Set(sorted.flatMap((s) => s.evals.map((e) => e.id)))].sort(),
    };
  });
  return {
    experiments,
    skipped: [],
    latest: () => makeScope("latest-snapshots", experiments.map((e) => e.latest), experiments.flatMap((e) => e.latest.attempts), []),
    current: () => makeScope("current-evals", experiments.map((e) => e.latest), experiments.flatMap((e) => e.latest.attempts), []),
  } as unknown as Results;
}

/** 管线便捷入口:装载 → resolve,停在树节点(与 show/view 同一条 resolve 管线,不带渲染面)。 */
async function resolveDefinition(definition: ReportDefinition, scope: Scope): Promise<unknown> {
  const page = pickReportPage(definition);
  return resolveReportTree(page.content, {
    scope,
    results: resultsOf(scope.snapshots),
    report: buildReportMeta(definition, scope),
    page: { id: page.id, input: "scope" },
    memo: new ResolveMemo(),
  });
}

async function resolveOnScope(node: ReportNode, scope: Scope): Promise<unknown> {
  return resolveDefinition(defineReport(node), scope);
}

// ───────────────────────── 警告 fixture(按 ScopeWarning 联合造,只剩三种 kind)─────────────────────────

function unfinishedSnapshot(id: string): ScopeWarning {
  return {
    kind: "unfinished-snapshot",
    experimentId: id,
    startedAt: "2026-07-11T00:00:00Z",
    dir: `/results/${id}`,
    message: `snapshot "${id}" (2026-07-11T00:00:00Z) is unfinished (the process was interrupted); completed attempts are read as-is, but the set may be incomplete — re-run \`niceeval exp ${id}\` for a complete snapshot`,
    command: `niceeval exp ${id}`,
  };
}

function unreadableSnapshot(dir: string): ScopeWarning {
  return {
    kind: "unreadable-snapshot",
    dir,
    reason: "malformed",
    message: `snapshot at "${dir}" is malformed and was skipped; inspect snapshot.json in that directory for corrupted JSON or a missing required field`,
  };
}

// ───────────────────────── Hero 与 HeroCard ─────────────────────────

describe("Hero 与 HeroCard", () => {
  const heroScope = () =>
    scopeOf([
      snap({ experimentId: "exp/a", results: [res("q1", "passed")], runStartedAt: "2026-07-01T10:00:00Z" }),
      snap({ experimentId: "exp/b", results: [res("q1", "failed")], runStartedAt: "2026-07-03T10:00:00Z" }),
      snap({ experimentId: "exp/c", results: [res("q2", "passed")], runStartedAt: "2026-07-02T10:00:00Z" }),
    ]);

  it("<Hero /> 的 resolve 结果携带走完回退链的站点标题,与浏览器标题(reportTitleText)同源", async () => {
    const scope = heroScope();
    const definition = defineReport({ title: { en: "Memory Evals" }, content: <Hero /> });
    expect(reportTitleText(definition, scope, "en")).toBe("Memory Evals");
    const meta = buildReportMeta(definition, scope);
    const resolved = (await resolveDefinition(definition, scope)) as { type: unknown; props: { title: unknown } };
    expect(resolved.type).toBe(HeroCard);
    expect(resolved.props.title).toEqual(meta.title);
  });

  it("显式 title prop 覆盖站点声明", async () => {
    const scope = heroScope();
    const resolved = (await resolveOnScope(<Hero title="Custom Hero" />, scope)) as { props: { title: unknown } };
    expect(resolved.props.title).toBe("Custom Hero");
  });

  it("<Hero /> 与手写 <HeroCard title={ctx.report.title} data={await heroData(ctx.scope)} /> resolve 结果结构严格等价", async () => {
    const scope = heroScope();
    const Handwritten = defineComponent(async (_props: Record<never, never>, ctx) => (
      <HeroCard title={ctx.report.title} data={await heroData(ctx.scope)} />
    ));
    const [heroResolved, handResolved] = (await Promise.all([
      resolveOnScope(<Hero />, scope),
      resolveOnScope(<Handwritten />, scope),
    ])) as [{ type: unknown; props: unknown }, { type: unknown; props: unknown }];
    expect(heroResolved.type).toBe(HeroCard);
    expect(heroResolved).toEqual(handResolved);
  });

  it("heroData:latestStartedAt 取范围内最新快照开始时间、snapshots 计贡献快照数", async () => {
    const scope = heroScope();
    const data = await heroData(scope);
    expect(data.latestStartedAt).toBe("2026-07-03T10:00:00Z");
    expect(data.snapshots).toBe(3);
  });

  it("空 Scope:latestStartedAt 为 null(不编造当前时间),snapshots 为 0", async () => {
    const empty = scopeOf([]);
    const data = await heroData(empty);
    expect(data).toEqual({ latestStartedAt: null, snapshots: 0 });
  });
});

// ───────────────────────── ScopeWarnings 的聚合层:groupScopeWarnings ─────────────────────────

describe("groupScopeWarnings(按动作聚合,web/text 两面共用的纯函数)", () => {
  it("带 experimentId 的 unfinished-snapshot 各自成组:组头是实验 id、带徽标与去重后的命令;不同实验各自一组", () => {
    const warnings = [unfinishedSnapshot("exp/a"), unfinishedSnapshot("exp/b")];
    const { groups } = groupScopeWarnings(warnings, "en");
    expect(groups).toHaveLength(2);
    const groupA = groups.find((g) => g.title === "exp/a")!;
    expect(groupA.badges.map((b) => b.text)).toEqual(["unfinished"]);
    expect(groupA.headCommand).toBe("niceeval exp exp/a");
    const groupB = groups.find((g) => g.title === "exp/b")!;
    expect(groupB.headCommand).toBe("niceeval exp exp/b");
  });

  it("组排序:实验作用域组在前(按实验 id 字典序),非实验作用域组(按 kind)在后;未登记的 kind 单独成组、message 原样保留", () => {
    const unknown = {
      kind: "future-kind",
      message: "something new happened; check the docs for future-kind",
    } as unknown as ScopeWarning;
    // 声明顺序故意把非实验作用域组放最前,验证排序不依赖出现顺序
    const warnings = [unreadableSnapshot("/results/bad"), unfinishedSnapshot("exp/b"), unfinishedSnapshot("exp/a"), unknown];
    const { groups } = groupScopeWarnings(warnings, "en");
    const titles = groups.map((g) => g.title);
    // 实验组按 id 字典序排在前:exp/a 先于 exp/b。
    expect(titles.indexOf("exp/a")).toBeLessThan(titles.indexOf("exp/b"));
    // 两个实验组都排在非实验作用域组(unreadable-snapshot 的组头文案、未登记 kind)之前。
    const lastExperimentPos = Math.max(titles.indexOf("exp/a"), titles.indexOf("exp/b"));
    expect(lastExperimentPos).toBeLessThan(titles.indexOf("1 snapshot skipped"));
    expect(lastExperimentPos).toBeLessThan(titles.indexOf("future-kind"));
    const unknownGroup = groups.find((g) => g.title === "future-kind")!;
    expect(unknownGroup.warnings[0]!.message).toBe("something new happened; check the docs for future-kind");
  });

  it("summary 是分类计数汇总、随单复数变化;detailsOpen 阈值是总条数 ≤ 3(跨组计数,不是按组)", () => {
    const two = groupScopeWarnings([unfinishedSnapshot("exp/a"), unfinishedSnapshot("exp/b")], "en");
    expect(two.summary).toBe("2 experiments flagged");
    const one = groupScopeWarnings([unfinishedSnapshot("exp/a")], "en");
    expect(one.summary).toBe("1 experiment flagged");

    const three = [unfinishedSnapshot("exp/a"), unfinishedSnapshot("exp/b"), unreadableSnapshot("/results/bad")];
    expect(groupScopeWarnings(three, "en").detailsOpen).toBe(true);
    const four = [...three, unreadableSnapshot("/results/bad2")];
    expect(groupScopeWarnings(four, "en").detailsOpen).toBe(false);
  });

  it("下一步随行:不带 command 的条目 headCommand 为 null,不硬造动作;message 原样保留", () => {
    const noCommand = {
      kind: "missing-startedAt",
      experimentId: "exp/a",
      evalId: "q1",
      message: "attempt identity for exp/a q1 lacks startedAt; check the writer that produced it",
    } as unknown as ScopeWarning;
    const { groups } = groupScopeWarnings([noCommand], "en");
    expect(groups[0]!.headCommand).toBeNull();
    expect(groups[0]!.warnings[0]!.message).toBe(noCommand.message);
  });

  it("空警告集:零组、空 summary", () => {
    const empty = groupScopeWarnings([], "en");
    expect(empty.groups).toEqual([]);
    expect(empty.summary).toBe("");
  });
});

describe("scopeWarningsData", () => {
  it("Scope 携带的挑选警告原样透出", async () => {
    const warnings = [unfinishedSnapshot("exp/a")];
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed")] })], warnings);
    await expect(scopeWarningsData(scope)).resolves.toEqual(scope.warnings);
  });

  it("裸 Snapshot[] 输入没有挑选过程,返回空数组", async () => {
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed")] })], [unfinishedSnapshot("exp/a")]);
    await expect(scopeWarningsData(scope.snapshots)).resolves.toEqual([]);
  });
});

// ───────────────────────── CopyFixPrompt ─────────────────────────

describe("copyFixPromptData", () => {
  const failedRes = () =>
    res("fix/failed", "failed", {
      assertions: [
        {
          name: "equals",
          severity: "gate",
          outcome: "failed" as const,
          score: 0,
          detail: "equals(42)",
          expected: "42",
          received: "41",
        },
      ] as AssertionResult[],
    });
  const erroredRes = () =>
    res("fix/errored", "errored", {
      error: { code: "sandbox-create-failed", message: "docker daemon unreachable", phase: "sandbox.create" },
    });
  const failingScope = () =>
    scopeOf([snap({ experimentId: "exp/a", results: [failedRes(), erroredRes(), res("fix/passed", "passed")] })]);

  it("两失败 fixture 的 prompt 含 eval id、主失败摘要与 attempt 下钻命令;failures 计入 failed 与 errored 两类,不计 passed", async () => {
    const scope = failingScope();
    const data = await copyFixPromptData(scope);
    expect(data.failures).toBe(2);
    expect(data.prompt).toContain('eval "fix/failed"');
    expect(data.prompt).toContain('eval "fix/errored"');
    expect(data.prompt).toContain("equals(42)");
    expect(data.prompt).toContain("docker daemon unreachable");
    expect(data.prompt).toMatch(/inspect: niceeval show @1[0-9a-z]{7}/);
  });

  it("全 passed 时 prompt 为空串、failures 为 0", async () => {
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed"), res("q2", "passed")] })]);
    await expect(copyFixPromptData(scope)).resolves.toEqual({ prompt: "", failures: 0 });
  });
});

// ───────────────────────── TraceWaterfall ─────────────────────────

describe("traceWaterfallData", () => {
  const spans: TraceSpan[] = [
    // 故意乱序声明:验证按 startOffsetMs 升序
    { traceId: "t", spanId: "s2", name: "model call", startMs: 1500, endMs: 2500, kind: "model", status: "ok" },
    { traceId: "t", spanId: "s1", name: "turn 1", startMs: 1000, endMs: 3000, kind: "turn" },
    { traceId: "t", spanId: "s3", name: "tool: bash", startMs: 2600, endMs: 2900, kind: "tool", status: "error" },
    // 子 span:不进顶层摘要
    { traceId: "t", spanId: "s4", parentSpanId: "s1", name: "nested child", startMs: 1100, endMs: 1200, kind: "tool" },
  ];

  const traceScope = () =>
    scopeOf([
      snap({
        experimentId: "exp/a",
        results: [res("trace/with", "failed"), res("trace/without", "passed")],
        traces: { "trace/with": spans },
      }),
    ]);

  it("两 attempt(一含失败 span):spans 按 startOffsetMs 升序、只含顶层 span,kind 归一(turn→agent),failed 取自 status", async () => {
    const rows = await traceWaterfallData(traceScope());
    expect(rows).toHaveLength(2);
    const withTrace = rows.find((r) => r.evalId === "trace/with")!;
    expect(withTrace.durationMs).toBe(2000);
    expect(withTrace.spans.map((s) => s.name)).toEqual(["turn 1", "model call", "tool: bash"]);
    expect(withTrace.spans.map((s) => s.startOffsetMs)).toEqual([0, 500, 1600]);
    expect(withTrace.spans.map((s) => s.kind)).toEqual(["agent", "model", "tool"]);
    expect(withTrace.spans.map((s) => s.failed)).toEqual([false, false, true]);
  });

  it("缺 trace.json 的 attempt:durationMs 为 null 且行不消失、spans 为空数组,证据位置如实显示缺失", async () => {
    const rows = await traceWaterfallData(traceScope());
    const without = rows.find((r) => r.evalId === "trace/without")!;
    expect(without.durationMs).toBeNull();
    expect(without.spans).toEqual([]);
  });

  it("runner 生命周期节点不进瀑布行:span 事实只来自 trace artifact,result.phases 不被读取", async () => {
    const withPhases = res("trace/phased", "passed", {
      phases: [{ name: "sandbox.create", durationMs: 5000 }] as EvalResult["phases"],
    });
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [withPhases], traces: { "trace/phased": spans } })]);
    const rows = await traceWaterfallData(scope);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spans.map((s) => s.name)).toEqual(["turn 1", "model call", "tool: bash"]);
    expect(rows[0]!.spans.some((s) => s.name.includes("sandbox"))).toBe(false);
  });
});
