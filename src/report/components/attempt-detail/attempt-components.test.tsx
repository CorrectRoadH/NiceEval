// cases: docs/engineering/testing/unit/reports.md
// Attempt 详情组件族的单元测试:11 个叶子的 attempt*Data 非空/空证据矩阵与 validate*Data 校验、
// AttemptAssessment 的 source/assertions fallback 展开树、AttemptDetail 的内建顺序(组合函数产出的
// 树,不经渲染)、spec/data 等价与 scope-input page 报错、AttemptConversation 的 loc 分轮与容错、
// attemptSourceData 的 loc 投影。观察面全部是 *Data 计算结果、resolve 后的树节点类型与错误对象;
// 不构造渲染产物——DOM 结构、`<details>` 的 open 折叠标记、text 面下钻命令文本、两面逐字比较均归
// E2E 报告域(docs/engineering/testing/e2e/report.md §5 结构/终端排版)。

import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, StreamEvent, Verdict } from "../../../types.ts";
import type { Results, Scope } from "../../../results/index.ts";
import { makeScope } from "../../../results/select.ts";
import type { AttemptEvidence, AttemptEvidenceCapabilities } from "../../../results/attempt-evidence.ts";
import { encodeAttemptLocator, type AttemptIdentity } from "../../../results/locator.ts";
import { composeOf, resolveReportTree, ResolveMemo, type ReportNode } from "../../definition/tree.ts";
import { buildReportMeta, defineReport } from "../../definition/report.ts";
import {
  attemptAssertionsData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSourceData,
  attemptSummaryData,
  attemptTimelineData,
  attemptTraceData,
  attemptUsageData,
} from "./compute.ts";
import {
  AttemptAssertions,
  AttemptAssessment,
  AttemptConversation,
  AttemptDetail,
  AttemptDiagnostics,
  AttemptDiff,
  AttemptError,
  AttemptFixPrompt,
  AttemptSource,
  AttemptSummary,
  AttemptTimeline,
  AttemptTrace,
  AttemptUsage,
  validateAssertionsData,
  validateConversationData,
  validateDiagnosticsData,
  validateDiffData,
  validateErrorData,
  validateFixPromptData,
  validateSourceData,
  validateSummaryData,
  validateTimelineData,
  validateTraceData,
  validateUsageData,
} from "./index.tsx";

// ───────────────────────── fixture ─────────────────────────

function identityOf(overrides: Partial<AttemptIdentity> = {}): AttemptIdentity {
  return { experimentId: "exp/a", snapshotStartedAt: "2026-07-01T00:00:00.000Z", evalId: "eval/one", attempt: 0, ...overrides };
}

function resultOf(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "eval/one",
    agent: "agent-x",
    verdict: "passed" as Verdict,
    attempt: 0,
    durationMs: 1000,
    assertions: [],
    ...overrides,
  };
}

const FULL_CAPS: AttemptEvidenceCapabilities = { source: true, execution: true, timing: true, diff: true };
const NO_CAPS: AttemptEvidenceCapabilities = { source: false, execution: false, timing: false, diff: false };

function evidenceOf(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  const identity = overrides.identity ?? identityOf();
  return {
    locator: overrides.locator ?? encodeAttemptLocator(identity),
    identity,
    result: overrides.result ?? resultOf(),
    events: overrides.events ?? null,
    evalSource: overrides.evalSource ?? null,
    execution: overrides.execution ?? null,
    diff: overrides.diff ?? null,
    trace: overrides.trace ?? null,
    artifactPaths: overrides.artifactPaths ?? { dir: "/results/exp/a/eval-one/a0" },
    capabilities: overrides.capabilities ?? NO_CAPS,
  };
}

function scopeAndResults(): { scope: Scope; results: Results } {
  const scope = makeScope("current-evals", [], []);
  const results = { experiments: [], skipped: [], latest: () => scope, current: () => scope } as unknown as Results;
  return { scope, results };
}

/** resolve 单个 attempt-input page 节点,注入给定的 evidence。 */
async function resolveOnAttemptPage(node: ReportNode, evidence: AttemptEvidence): Promise<unknown> {
  const { scope, results } = scopeAndResults();
  const page = { id: "attempt", input: "attempt" as const, locator: evidence.locator, evidence };
  return resolveReportTree(node, {
    scope,
    results,
    report: buildReportMeta(defineReport(node), scope),
    page,
    memo: new ResolveMemo(),
  });
}

/** resolve 一份放在 scope-input page 上的节点(默认 report 页,没有 attempt evidence)。 */
async function resolveOnScopePage(node: ReportNode): Promise<unknown> {
  const { scope, results } = scopeAndResults();
  return resolveReportTree(node, {
    scope,
    results,
    report: buildReportMeta(defineReport(node), scope),
    page: { id: "report", input: "scope" },
    memo: new ResolveMemo(),
  });
}

// ───────────────────────── 11 个叶子的非空/空证据矩阵 ─────────────────────────

describe("Attempt 详情组件族:非空/空证据矩阵", () => {
  it("AttemptSummary 恒非空", () => {
    const evidence = evidenceOf({ capabilities: FULL_CAPS });
    const data = attemptSummaryData(evidence);
    expect(data.locator).toBe(evidence.locator);
    expect(data.verdict).toBe("passed");
    expect(validateSummaryData(data)).toBeNull();
  });

  it("AttemptSummary 的 startedAt 取自 result.startedAt,identity.attempt 是零基下标,缺失 startedAt 时字段不产生", () => {
    const withBoth = evidenceOf({
      identity: identityOf({ attempt: 2 }),
      result: resultOf({ attempt: 2, startedAt: "2026-01-01T12:34:00.000Z" }),
    });
    const dataWithBoth = attemptSummaryData(withBoth);
    expect(dataWithBoth.startedAt).toBe("2026-01-01T12:34:00.000Z");
    expect(dataWithBoth.identity.attempt).toBe(2);

    const withoutStartedAt = evidenceOf({ result: resultOf({ startedAt: undefined }) });
    const dataWithoutStartedAt = attemptSummaryData(withoutStartedAt);
    expect(dataWithoutStartedAt.startedAt).toBeUndefined();
  });

  it("AttemptError:没有 error 时 null,有 error 时结构化字段齐全", () => {
    expect(attemptErrorData(evidenceOf())).toBeNull();
    const withError = evidenceOf({
      result: resultOf({ verdict: "errored", error: { code: "timeout", message: "boom", phase: "eval.run" } }),
    });
    expect(attemptErrorData(withError)).toEqual({ code: "timeout", message: "boom", phase: "eval.run" });
    expect(validateErrorData(attemptErrorData(withError))).toBeNull();
  });

  it("AttemptAssertions:没有 assertion 时 null,有时按 attention/passedGroups 分桶", () => {
    expect(attemptAssertionsData(evidenceOf())).toBeNull();
    const assertions: AssertionResult[] = [
      { name: "a", severity: "gate", outcome: "failed", score: 0 },
      { name: "b", severity: "gate", outcome: "passed", score: 1, groupPath: ["g1"] },
      { name: "c", severity: "gate", outcome: "passed", score: 1, groupPath: ["g1"] },
    ];
    const data = attemptAssertionsData(evidenceOf({ result: resultOf({ verdict: "failed", assertions }) }))!;
    expect(data.attention.map((a) => a.name)).toEqual(["a"]);
    expect(data.passedGroups).toEqual([{ group: "g1", items: [assertions[1], assertions[2]] }]);
    expect(data.scoreEntries).toBeUndefined(); // 通过制 attempt 恒没有给分记录,不摆空数组
    expect(validateAssertionsData(data)).toBeNull();
  });

  it("AttemptAssertions:计分制 eval 的 .points 挣分随断言一起出现,不需要单独投影", () => {
    const assertions: AssertionResult[] = [
      { name: "a", severity: "gate", outcome: "passed", score: 1, points: 3 },
      { name: "b", severity: "gate", outcome: "failed", score: 0, points: 0 },
    ];
    const data = attemptAssertionsData(
      evidenceOf({ result: resultOf({ verdict: "failed", scoring: "points", assertions }) }),
    )!;
    expect((data.attention[0] as { points?: number }).points).toBe(0); // 挂了的检查点如实显示挣到 0 分,不隐藏
    expect((data.passedGroups[0]!.items[0]! as { points?: number }).points).toBe(3);
    expect(validateAssertionsData(data)).toBeNull();
  });

  it("AttemptAssertions:t.score(label, n) 的给分记录按 groupPath 分组,与 passedGroups 同一套算法", () => {
    const data = attemptAssertionsData(
      evidenceOf({
        result: resultOf({
          verdict: "passed",
          scoring: "points",
          scoreEntries: [
            { label: "代码精简", points: 15, groupPath: ["代码质量"] },
            { label: "重构说明", points: 16, groupPath: ["代码质量"] },
            { label: "无分组给分", points: 2 },
          ],
        }),
      }),
    )!;
    expect(data.attention).toEqual([]); // 没有 assertions,但存在给分记录,data 不是 null
    expect(data.passedGroups).toEqual([]);
    expect(data.scoreEntries).toEqual([
      { group: "代码质量", items: [{ label: "代码精简", points: 15, groupPath: ["代码质量"] }, { label: "重构说明", points: 16, groupPath: ["代码质量"] }] },
      { group: "", items: [{ label: "无分组给分", points: 2 }] },
    ]);
    expect(validateAssertionsData(data)).toBeNull();
  });

  it("AttemptSource:没有 source 时 null(evalSource null 或 capability 假)", () => {
    expect(attemptSourceData(evidenceOf())).toBeNull();
    const withSource = evidenceOf({
      capabilities: { ...NO_CAPS, source: true },
      evalSource: {
        sourcePath: "evals/a.ts",
        sourceSha256: "x",
        lines: [{ line: 1, text: "t.expect(1).toBe(1)", assertions: [], sends: [] }],
        unmapped: [],
        summary: {
          totalAssertions: 0,
          mappedAssertions: 0,
          unmappedAssertions: 0,
          passed: 0,
          failed: 0,
          gate: 0,
          soft: 0,
          totalLines: 1,
          annotatedLines: 0,
        },
      },
    });
    expect(attemptSourceData(withSource)?.sourcePath).toBe("evals/a.ts");
    expect(validateSourceData(attemptSourceData(withSource))).toBeNull();
  });

  it("AttemptFixPrompt:passed 时 null,failed 且有可归因原因时给出可复制 prompt", () => {
    expect(attemptFixPromptData(evidenceOf())).toBeNull();
    const failed = evidenceOf({
      result: resultOf({
        verdict: "failed",
        assertions: [{ name: "check", severity: "gate", outcome: "failed", score: 0, detail: "expected true" }],
      }),
    });
    const data = attemptFixPromptData(failed);
    expect(data?.prompt).toContain("exp/a");
    expect(data?.prompt).toContain(`niceeval show ${failed.locator}`);
    expect(validateFixPromptData(data)).toBeNull();
  });

  it("AttemptTimeline:没有 phase 时 null", () => {
    expect(attemptTimelineData(evidenceOf())).toBeNull();
    const withPhases = evidenceOf({
      result: resultOf({ phases: [{ name: "eval.run", durationMs: 10 }] }),
      trace: [{ traceId: "t1", spanId: "s1", name: "model-call", startMs: 0, endMs: 100 }],
    });
    const data = attemptTimelineData(withPhases);
    expect(data?.phases).toHaveLength(1);
    expect(validateTimelineData(data)).toBeNull();
  });

  it("AttemptConversation:没有 events 时 null", () => {
    expect(attemptConversationData(evidenceOf())).toBeNull();
    expect(attemptConversationData(evidenceOf({ events: [] }))).toBeNull();
  });

  it("AttemptDiagnostics:没有 diagnostics 时 null", () => {
    expect(attemptDiagnosticsData(evidenceOf())).toBeNull();
    const withDiag = evidenceOf({
      result: resultOf({ diagnostics: [{ code: "cleanup-failed", level: "warning", message: "m", phase: "eval.teardown" }] }),
    });
    const data = attemptDiagnosticsData(withDiag);
    expect(data?.groups).toEqual([
      { phase: "eval.teardown", items: [{ code: "cleanup-failed", level: "warning", message: "m", phase: "eval.teardown" }] },
    ]);
    expect(validateDiagnosticsData(data)).toBeNull();
  });

  it("AttemptUsage:没有 usage 时 null", () => {
    expect(attemptUsageData(evidenceOf())).toBeNull();
    const withUsage = evidenceOf({ result: resultOf({ usage: { inputTokens: 10, outputTokens: 5 } }) });
    const data = attemptUsageData(withUsage);
    expect(data?.usage.inputTokens).toBe(10);
    expect(validateUsageData(data)).toBeNull();
  });

  it("AttemptTrace:没有 trace 时 null", () => {
    expect(attemptTraceData(evidenceOf())).toBeNull();
    const withTrace = evidenceOf({ trace: [{ traceId: "t1", spanId: "s1", name: "model-call", startMs: 0, endMs: 100 }] });
    const data = attemptTraceData(withTrace);
    expect(data?.spans).toHaveLength(1);
    expect(validateTraceData(data)).toBeNull();
  });

  it("AttemptDiff:没有变更时 null,net:none 的触碰不进列表", () => {
    expect(attemptDiffData(evidenceOf())).toBeNull();
    const diff = {
      windows: [
        {
          window: "s1/t1",
          changes: {
            "a.ts": { status: "modified" as const, before: "1\n2", after: "1\n3" },
            "b.ts": { status: "modified" as const, before: "x", after: "x" },
          },
        },
      ],
      files: {
        "a.ts": { net: "modified" as const, windows: ["s1/t1"] },
        "b.ts": { net: "none" as const, windows: ["s1/t1"] },
      },
      get: (path: string) => (path === "a.ts" ? "1\n3" : "x"),
    };
    const withDiff = evidenceOf({ capabilities: { ...NO_CAPS, diff: true }, diff });
    const data = attemptDiffData(withDiff);
    expect(data?.files.map((f) => f.path)).toEqual(["a.ts"]);
    expect(data?.files[0]!.lines).toEqual({ added: 1, deleted: 1 });
    expect(validateDiffData(data)).toBeNull();
  });
});

// ───────────────────────── AttemptAssessment / AttemptDetail ─────────────────────────

describe("AttemptAssessment / AttemptDetail(组合组件)", () => {
  it("有 source 时展开树含 AttemptSource 不含 AttemptAssertions;无 source 时相反", async () => {
    for (const [evidence, expectSource] of [
      [evidenceOf({ capabilities: { ...NO_CAPS, source: true } }), true],
      [evidenceOf({ capabilities: NO_CAPS }), false],
    ] as const) {
      const resolved = (await resolveOnAttemptPage(<AttemptAssessment />, evidence)) as { props: { children: Array<{ type: unknown }> } };
      const types = resolved.props.children.map((c) => c.type);
      expect(types).toContain(AttemptError);
      expect(types.includes(AttemptSource)).toBe(expectSource);
      expect(types.includes(AttemptAssertions)).toBe(!expectSource);
    }
  });

  it("在 scope-input page 之外调用时 resolve 报完整用户反馈", async () => {
    await expect(resolveOnScopePage(<AttemptAssessment />)).rejects.toThrow(/attempt-input page/);
  });

  it("AttemptDetail:有 source 时不重复 Conversation，无 source 时在 usage 后保留 fallback", () => {
    // AttemptDetail 自己是组合组件:resolve 会把它(以及嵌套的 AttemptAssessment)递归展开,
    // 所以这里直接检查它的 compose 函数产出的原始树(与「内建报告」测试检查 standard.tsx
    // 原始声明同一手法),不走完整 resolve——那样 AttemptAssessment 会被替换成它自己展开出的
    // <Col> 而不再是 AttemptAssessment 这个类型。
    const compose = composeOf(AttemptDetail)!;
    const childTypes = (evidence: AttemptEvidence): unknown[] => {
      const tree = compose({}, { page: { input: "attempt", evidence } } as never) as unknown as {
        props: { children: Array<{ type: unknown } | null> };
      };
      return tree.props.children.filter((child): child is { type: unknown } => child !== null).map((child) => child.type);
    };
    const withoutSource = childTypes(evidenceOf());
    expect(withoutSource).toEqual([
      AttemptSummary,
      AttemptAssessment,
      AttemptFixPrompt,
      AttemptTimeline,
      AttemptDiagnostics,
      AttemptUsage,
      AttemptConversation,
      AttemptTrace,
      AttemptDiff,
    ]);

    const withSource = childTypes(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true },
        evalSource: {
          sourcePath: "evals/a.ts",
          sourceSha256: "x",
          lines: [{ line: 1, text: "", assertions: [], sends: [] }],
          unmapped: [],
          summary: {
            totalAssertions: 0,
            mappedAssertions: 0,
            unmappedAssertions: 0,
            passed: 0,
            failed: 0,
            gate: 0,
            soft: 0,
            totalLines: 1,
            annotatedLines: 0,
          },
        },
      }),
    );
    expect(withSource).toEqual(withoutSource.filter((type) => type !== AttemptConversation));
  });
});

// ───────────────────────── spec/data 等价与 scope-input page 报错 ─────────────────────────

describe("叶子组件的 spec/data 形态", () => {
  it("<AttemptSummary /> 在 attempt page 内的 spec 结果与手工 attemptSummaryData(evidence) 深等", async () => {
    const evidence = evidenceOf({ capabilities: FULL_CAPS });
    const resolved = (await resolveOnAttemptPage(<AttemptSummary />, evidence)) as { props: { data: unknown } };
    expect(resolved.props.data).toEqual(attemptSummaryData(evidence));
  });

  it("<AttemptSummary /> 放进 scope-input page 报错,文案含移到 attempt-input page 或传入 evidence", async () => {
    await expect(resolveOnScopePage(<AttemptSummary />)).rejects.toThrow(/attempt-input page/);
  });

  it("显式传 data 时不再取当前 page 的 evidence(scope-input page 上也能直接渲染)", async () => {
    const data = attemptSummaryData(evidenceOf());
    const resolved = (await resolveOnScopePage(<AttemptSummary data={data} />)) as { props: { data: unknown } };
    expect(resolved.props.data).toEqual(data);
  });

  it("同时传 data 与 input 报完整用户反馈,不静默取一边", async () => {
    const evidence = evidenceOf();
    const data = attemptSummaryData(evidence);
    await expect(
      resolveOnScopePage(
        // @ts-expect-error data 与 input 字段互斥,类型层已拒绝;这里模拟无类型 JS 输入
        <AttemptSummary data={data} input={evidence} />,
      ),
    ).rejects.toThrow(/both `data` and `input`/);
  });
});

// ───────────────────────── AttemptConversation:loc 分轮 ─────────────────────────

describe("AttemptConversation:标准事件流按 loc 分轮", () => {
  it("send(带 loc)后紧跟同文本无 loc 回显,回复仍全部聚到 send 行", () => {
    const loc = { file: "evals/a.ts", line: 5 };
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "hello", loc },
      { type: "message", role: "user", text: "hello" }, // 原生 transcript 回显,无 loc
      { type: "message", role: "assistant", text: "hi there" },
    ];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds).toHaveLength(1);
    expect(data.rounds[0]!.loc).toEqual(loc);
    expect(data.rounds[0]!.replies).toEqual([{ kind: "assistant", text: "hi there" }]);
    expect(validateConversationData(data)).toBeNull();
  });

  it("混入完全未知的事件类型时该条目原始 JSON 保留,不吞没其余事件", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events = [
      { type: "message", role: "user", text: "go", loc },
      { type: "future.thing", weird: true },
      { type: "message", role: "assistant", text: "ok" },
    ] as unknown as StreamEvent[];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds[0]!.replies.map((r) => r.kind)).toEqual(["raw", "assistant"]);
    expect(data.rounds[0]!.replies[0]).toEqual({ kind: "raw", raw: { type: "future.thing", weird: true } });
    expect(validateConversationData(data)).toBeNull();
  });

  it("skill.loaded 显示 Skill 名,不伪装成工具调用", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "go", loc },
      { type: "skill.loaded", skill: "pdf-tools" },
    ];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds[0]!.replies).toEqual([{ kind: "skill", skill: "pdf-tools" }]);
    expect(validateConversationData(data)).toBeNull();
  });

  it("context.injected 是已知一等事件，保留 source/text 而不落入 raw JSON 兜底", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "go", loc },
      { type: "context.injected", source: "SessionStart", text: "project guidance" },
    ];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds[0]!.replies).toEqual([{ kind: "context", source: "SessionStart", text: "project guidance" }]);
    expect(validateConversationData(data)).toBeNull();
  });

  it("流首无 loc 的 user 消息(旧 artifact)仍开 noloc 兜底轮", () => {
    const events: StreamEvent[] = [{ type: "message", role: "assistant", text: "orphan reply" }];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds).toHaveLength(1);
    expect(data.rounds[0]!.loc).toBeUndefined();
    expect(data.rounds[0]!.replies).toEqual([{ kind: "assistant", text: "orphan reply" }]);
    expect(validateConversationData(data)).toBeNull();
  });

  it("action.called + action.result 按 callId 合并成一条 tool 回复", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "go", loc },
      { type: "action.called", callId: "c1", name: "bash", input: { command: "ls" }, tool: "shell" },
      { type: "action.result", callId: "c1", output: "file.txt", status: "completed" },
    ];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds[0]!.replies).toEqual([
      { kind: "tool", callId: "c1", name: "bash", tool: "shell", input: { command: "ls" }, output: "file.txt", status: "completed" },
    ]);
    expect(validateConversationData(data)).toBeNull();
  });
});

// bug: memory/attempt-detail-components-shipped-without-styles.md
describe("attemptSourceData:标准事件流按 loc 投影回 send 行", () => {
  it("send 行的 turns 携带 sentText 与按序归并的完整回复", () => {
    const sourcePath = "evals/a.ts";
    const data = attemptSourceData(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true, execution: true },
        evalSource: {
          sourcePath,
          sourceSha256: "x",
          lines: [
            { line: 1, text: 'import { defineEval } from "niceeval";', assertions: [], sends: [] },
            {
              line: 2,
              text: 'const reply = await t.send("hello");',
              assertions: [],
              sends: [{ label: "s1/t1", status: "completed" as const, durationMs: 120, loc: { file: sourcePath, line: 2 } }],
            },
          ],
          unmapped: [],
          summary: {
            totalAssertions: 0,
            mappedAssertions: 0,
            unmappedAssertions: 0,
            passed: 0,
            failed: 0,
            gate: 0,
            soft: 0,
            totalLines: 2,
            annotatedLines: 1,
          },
        },
        events: [
          { type: "message", role: "user", text: "hello", loc: { file: sourcePath, line: 2 } },
          { type: "message", role: "assistant", text: "assistant reply attached to the source line" },
        ],
      }),
    )!;

    expect(data.lines[1]!.turns[0]).toMatchObject({ label: "s1/t1", sentText: "hello" });
    expect(data.lines[1]!.turns[0]!.replies).toEqual([
      { kind: "assistant", text: "assistant reply attached to the source line" },
    ]);
    expect(data.lines[0]!.turns).toEqual([]);
  });
});
