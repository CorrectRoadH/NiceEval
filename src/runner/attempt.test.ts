// cases: docs/engineering/testing/unit/experiments-runner.md
//
// ctx.fact() 的作用域归属单测在本文件末尾单独一个 describe 块:sandbox hook / eval.setup /
// agent setup·send·teardown 上报的 fact 是否真的落进同一个 attempt 的 EvalResult.facts、
// 同 key 后写覆盖先写、非法 key / 非标量 value 是否完整报错(见
// docs/feature/results/architecture.md#facts运行事实)。
//
// 路径提升单测:agent.setup 写进沙箱 `__niceeval__/agent-setup.json` 的安装 manifest,
// runAttemptEffect 在 setup 之后把它读出来、原样挂到 EvalResult.agentSetup(见
// docs/feature/results/architecture.md「agent-setup.json」、src/agents/manifest.ts 的注释)。
// 沙箱是内存 fake(记文件,不起容器)——这里要验的是运行器自己「何时读、读到什么、读不到
// 怎么办」这段编排逻辑,不是 adapter 侧的 manifest 构造规则(那部分已在 agents/skills.test.ts
// 覆盖)。

import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { runAttemptEffect } from "./attempt.ts";
import { defineSandboxAgent, defineSandbox } from "../define.ts";
import { writeAgentSetupManifest, AGENT_SETUP_MANIFEST_PATH } from "../agents/manifest.ts";
import { equals } from "../expect/index.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type { Attempt, AgentRun, LifecyclePhase, RunOptions } from "./types.ts";
import type {
  AgentSetupManifest,
  Agent,
  CommandResult,
  Config,
  DiscoveredEval,
  Sandbox,
  SandboxFile,
  ScoreTestContext,
} from "../types.ts";

/** 内存沙箱:writeFiles/readFile 记文件,runShell 恒成功(供 initGitAndCommit / diff 采集用)。 */
class FakeSandbox implements Partial<Sandbox> {
  readonly workdir = "/workspace";
  readonly sandboxId = "fake";
  readonly otlpHost = null;
  readonly files = new Map<string, string>();

  constructor(private readonly stopDelayMs = 0) {}

  async runShell(): Promise<CommandResult> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async runCommand(): Promise<CommandResult> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async writeFiles(files: Record<string, string>, targetDir?: string): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(targetDir ? `${targetDir}/${path}` : path, content);
    }
  }
  async uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void> {
    for (const f of files) {
      this.files.set(targetDir ? `${targetDir}/${f.path}` : f.path, f.content.toString());
    }
  }
  async uploadFile(path: string, content: Buffer): Promise<void> {
    this.files.set(path, content.toString());
  }
  async uploadDirectory(): Promise<void> {}
  async downloadFile(path: string): Promise<Buffer> {
    return Buffer.from(this.files.get(path) ?? "");
  }
  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async readFile(path: string): Promise<string> {
    const hit = this.files.get(path);
    if (hit === undefined) throw new Error(`no such file: ${path}`);
    return hit;
  }
  async downloadDirectory(): Promise<void> {}
  async stop(): Promise<void> {
    if (this.stopDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.stopDelayMs));
  }
}

const asSandbox = (box: FakeSandbox): Sandbox => box as unknown as Sandbox;

const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };

/** 跑一次 attempt:给定 agent,返回 EvalResult。沙箱用内存 fake,不起容器/不联网。
 *  可选 `evalDefOverrides` 覆盖默认 evalDef 的字段(如挂一个 `setup`);可选 `onPhase` 透传给
 *  `runAttemptEffect` 的第五个参数,原样转发 attempt.ts 的 enterPhase 边界(见下方
 *  onPhase 回调专用的 describe 块);可选 `timeoutMs` 覆盖默认的 5s 外层超时(超时证据保全
 *  测试专用,见下方专用 describe 块)。 */
async function runOnce(
  agent: Agent,
  box: FakeSandbox,
  opts: {
    evalDefOverrides?: Partial<DiscoveredEval>;
    onPhase?: (phase: LifecyclePhase) => void;
    timeoutMs?: number;
  } = {},
): Promise<import("../types.ts").EvalResult> {
  const evalDef: DiscoveredEval = {
    id: "fake/eval",
    baseDir: "/project",
    sourcePath: "/project/fake.eval.ts",
    source,
    test: () => {},
    ...opts.evalDefOverrides,
  };
  const run: AgentRun = {
    agent,
    flags: {},
    runs: 1,
    earlyExit: true,
    // 自定义 provider:create() 直接返回内存 fake,绕开真实沙箱 provider。
    sandbox: defineSandbox({ name: "fake-provider", create: async () => asSandbox(box) }),
    timeoutMs: opts.timeoutMs ?? 5_000,
    selectedEvalIds: [evalDef.id],
  };
  const attempt: Attempt = { evalDef, run, attempt: 0, key: "fake/eval", fingerprint: "" };
  const config: Config = {};
  const runOpts: RunOptions = {
    config,
    evals: [evalDef],
    agentRuns: [run],
    reporters: [],
    maxConcurrency: 1,
  };
  const sandboxSem = Effect.runSync(Effect.makeSemaphore(1));
  return Effect.runPromise(runAttemptEffect(attempt, runOpts, sandboxSem, { onPhase: opts.onPhase }));
}

describe("runAttemptEffect · agent-setup 路径提升(沙箱 __niceeval__/agent-setup.json → EvalResult.agentSetup)", () => {
  it("沙箱内有 manifest 时,原样读出挂到 EvalResult.agentSetup(不做任何转换/裁剪)", async () => {
    const manifest: AgentSetupManifest = {
      skills: [
        { kind: "local", name: "effect-ts", path: "skills/effect-ts", sha256: "a".repeat(64) },
        { kind: "repo", source: "anthropics/skills", ref: "9d2f1ae187231d8199c64b5b762e1bdf2244733d", skills: ["pdf", "docx"] },
      ],
      nativePlugins: [
        {
          agent: "claude-code",
          marketplace: { name: "duyet", source: "duyet/codex-claude-plugins", ref: "82de4021a311034a9596e891baf3a8266fb33bf7" },
          name: "example-plugin",
          resolvedVersion: "1.2.3",
        },
      ],
      mcpServers: [{ name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] }],
    };

    const agent = defineSandboxAgent({
      name: "fake-agent",
      setup: async (sandbox) => {
        await writeAgentSetupManifest(sandbox, manifest);
      },
      send: async () => ({ events: [], status: "completed" }),
    });

    const box = new FakeSandbox();
    const result = await runOnce(agent, box);

    expect(result.error).toBeUndefined();
    // 沙箱内确实落了这个文件(否则下面的断言测不出"提升"这一步真的发生了)。
    expect(box.files.has(`${box.workdir}/${AGENT_SETUP_MANIFEST_PATH}`)).toBe(true);
    expect(result.agentSetup).toEqual(manifest); // 深相等:内容原样保留,没有裁剪或改形。
  });

  it("沙箱内没有 manifest 时(没装任何 Skill/plugin/MCP 的基线场景),不生成空/伪造的 artifact", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-install",
      // agent.setup 跑了(比如只装了 CLI 本体),但没有任何 skill/plugin/mcp 可写,
      // 所以从不调用 writeAgentSetupManifest —— 这是「基线场景」的真实形状。
      setup: async () => {},
      send: async () => ({ events: [], status: "completed" }),
    });

    const box = new FakeSandbox();
    const result = await runOnce(agent, box);

    expect(result.error).toBeUndefined();
    expect(box.files.has(`${box.workdir}/${AGENT_SETUP_MANIFEST_PATH}`)).toBe(false);
    expect(result.agentSetup).toBeUndefined();
  });

  it("agent 根本没有 setup 钩子时(非 coding agent adapter),同样不生成 agentSetup", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-setup",
      send: async () => ({ events: [], status: "completed" }),
    });

    const box = new FakeSandbox();
    const result = await runOnce(agent, box);

    expect(result.error).toBeUndefined();
    expect(result.agentSetup).toBeUndefined();
  });
});

// run.ts 的 reportFailure() 需要「失败发生时所在的阶段」,但 attempt:complete 一发出 coordinator
// 就把 active map 里对应条目删了,run.ts 没法事后反查——只能在 attempt.ts 每次真正跨入一个新
// phase 边界时同步拿到通知。这里直接单测 runAttemptEffect 的第五个参数(onPhase)是否真的随
// enterPhase 同步触发、顺序是否符合「没有对应 hook/配置的步骤直接跳过」的契约
//(docs/feature/experiments/cli.md「Attempt 阶段」),而不是只在 run.ts 集成测试里间接验证。
describe("runAttemptEffect · onPhase 回调随 enterPhase 同步触发", () => {
  it("挂了 eval.setup 与 agent.setup 时,phase 序列包含两者且不产生空阶段", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-with-setup",
      setup: async () => {},
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: LifecyclePhase[] = [];
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: { setup: async () => {} },
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.error).toBeUndefined();
    // sandbox-setup(没有 SandboxSpec.setup 钩子)与 telemetry-setup(没有 tracing)都该跳过——
    // 不产生空阶段,序列只含实际执行到的边界,严格按生命周期顺序出现一次。
    expect(phases).toEqual([
      "sandbox.queue",
      "sandbox.create",
      "workspace.baseline",
      "eval.setup",
      "agent.setup",
      "eval.run",
      "workspace.diff",
      "scoring.evaluate",
    ]);
  });

  it("没有 eval.setup / agent.setup 时,对应阶段整个不出现(不是出现后立刻跳过的空事件)", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-setup",
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: LifecyclePhase[] = [];
    const box = new FakeSandbox();
    await runOnce(agent, box, { onPhase: (phase) => phases.push(phase) });

    expect(phases).toEqual(["sandbox.queue", "sandbox.create", "workspace.baseline", "eval.run", "workspace.diff", "scoring.evaluate"]);
  });

  it("test() 抛出的普通执行错误不设置 skipReason,diff/scoring 仍照常进入", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-throws",
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: LifecyclePhase[] = [];
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        test: () => {
          throw new Error("boom-from-eval");
        },
      },
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.error?.message).toContain("boom-from-eval");
    expect(result.error?.phase).toBe("eval.run");
    // test() 里的普通异常被 runAttemptBody 内层 try/catch 收作 result.error,不设置
    // skipReason——所以 diff/scoring 的跳过条件(`!skipReason`)不成立,两个阶段仍会进入,
    // 最后落 teardown。这是「running 阶段失败」的真实序列。
    expect(phases).toEqual(["sandbox.queue", "sandbox.create", "workspace.baseline", "eval.run", "workspace.diff", "scoring.evaluate"]);
  });

  it("agent.setup 中途抛错时,phase 序列停在 agent-setup 就跳进 teardown(不会假装跑到了 running)", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-setup-throws",
      setup: async () => {
        throw new Error("boom-from-setup");
      },
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: LifecyclePhase[] = [];
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, { onPhase: (phase) => phases.push(phase) });

    expect(result.error?.message).toContain("boom-from-setup");
    expect(result.error?.phase).toBe("agent.setup");
    // 失败发生在 agent-setup:之后不再出现 running/diff/scoring —— run.ts 的 reportFailure()
    // 靠的正是这个真实的「最后已知阶段」,不是硬编码成 running(见 run.ts 的 lastPhase 注释)。
    expect(phases).toEqual(["sandbox.queue", "sandbox.create", "workspace.baseline", "agent.setup"]);
  });
});

// eval.teardown 的触发条件是「eval.setup 时点走到过」,不是「setup 声明且成功」(成对触发规则,
// 见 docs/runner.md「环境预置不进运行器,但按顺序调它」)。时点在 attempt.ts 里于调用
// evalDef.setup 之前就置位,所以 setup 抛错、乃至压根没声明 setup,都不豁免 teardown。
describe("runAttemptEffect · eval.teardown 的触发规则", () => {
  it("eval.setup 抛错时,eval.teardown 仍被调用(半初始化现场同样要扫尾)", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-eval-setup-throws",
      send: async () => ({ events: [], status: "completed" }),
    });
    let teardownCalls = 0;
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        setup: async () => {
          throw new Error("boom-from-eval-setup");
        },
        teardown: async () => {
          teardownCalls += 1;
        },
      },
    });

    expect(result.error?.message).toContain("boom-from-eval-setup");
    expect(result.error?.phase).toBe("eval.setup");
    expect(teardownCalls).toBe(1);
  });

  it("未声明 eval.setup 时,eval.teardown 依然触发(时点走到不依赖 setup 是否声明)", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-eval-setup",
      send: async () => ({ events: [], status: "completed" }),
    });
    let teardownCalls = 0;
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        teardown: async () => {
          teardownCalls += 1;
        },
      },
    });

    expect(result.error).toBeUndefined();
    expect(teardownCalls).toBe(1);
  });
});

describe("runAttemptEffect · 主链与 Scope 收尾的计时边界", () => {
  it("sandbox.stop 只计入收尾,主链 phase 合计不超过 durationMs", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-timed-stop",
      send: async () => ({ events: [], status: "completed" }),
    });
    const result = await runOnce(agent, new FakeSandbox(40));
    const phases = result.phases ?? [];
    const closing = new Set<LifecyclePhase>([
      "eval.teardown",
      "agent.teardown",
      "sandbox.teardown",
      "sandbox.suspend",
      "sandbox.stop",
    ]);
    const mainDurationMs = phases
      .filter((phase) => !closing.has(phase.name))
      .reduce((sum, phase) => sum + phase.durationMs, 0);
    const stop = phases.find((phase) => phase.name === "sandbox.stop");

    expect(stop?.durationMs).toBeGreaterThanOrEqual(30);
    expect(mainDurationMs).toBeLessThanOrEqual(result.durationMs);
  });
});

describe("runAttemptEffect · 计分制(scoring:\"points\")的挣分落盘", () => {
  const scoringAgent = () =>
    defineSandboxAgent({
      name: "fake-agent-scoring",
      send: async () => ({ events: [], status: "completed" }),
    });

  it(".points()/t.score() 的挣分正确写进 EvalResult.assertions[].points 与 scoreEntries", async () => {
    const result = await runOnce(scoringAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        scoring: "points",
        test: (async (t: ScoreTestContext) => {
          t.check("actual", equals("actual")).points(3); // 0/1 断言通过挣满 3 分
          t.score("手动给分", 7);
        }) as unknown as DiscoveredEval["test"],
      },
    });

    expect(result.scoring).toBe("points");
    const passedAssertion = result.assertions.find((a) => a.outcome === "passed") as { points?: number } | undefined;
    expect(passedAssertion?.points).toBe(3);
    expect(result.scoreEntries).toEqual([{ label: "手动给分", points: 7 }]);
  });

  it("通过制即使被运行时绕过类型调用 points/score，也不把给分字段落盘", async () => {
    const result = await runOnce(scoringAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        test: (async (t: ScoreTestContext) => {
          t.check("actual", equals("actual")).points(3);
          t.score("运行时绕过", 7);
        }) as unknown as DiscoveredEval["test"],
      },
    });
    expect(result.scoring).toBe("pass");
    expect((result.assertions[0] as { points?: number } | undefined)?.points).toBeUndefined();
    expect(result.scoreEntries).toBeUndefined();
  });

  it("计分制在评分前异常收束时也落空 scoreEntries，而非省略字段", async () => {
    const result = await runOnce(scoringAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        scoring: "points",
        setup: async () => {
          throw new Error("setup boom");
        },
      },
    });
    expect(result.verdict).toBe("errored");
    expect(result.scoreEntries).toEqual([]);
  });

  it("前置 .gate() 中止后:verdict 为 failed(非 errored),中止前的给分保留、中止后的记录被丢弃", async () => {
    const result = await runOnce(scoringAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        scoring: "points",
        test: (async (t: ScoreTestContext) => {
          t.score("早期给分", 5);
          await t.check("actual", equals("expected")).gate(); // 必然不匹配,就地中止 test()
          t.score("永不执行", 100); // 中止之后的给分不进结果
        }) as unknown as DiscoveredEval["test"],
      },
    });

    // 前置已经把断言记下来了,不是执行异常——中止挣 0 是 agent 的责任,verdict 是 failed
    // 不是 errored(见 docs/feature/experiments/score-points.md「计分制:叠加给分」)。
    expect(result.error).toBeUndefined();
    expect(result.verdict).toBe("failed");
    expect(result.scoreEntries).toEqual([{ label: "早期给分", points: 5 }]); // 没有"永不执行"那 100 分
    expect(result.assertions).toHaveLength(1); // 前置之后记录的断言被截断
    expect(result.assertions[0]!.outcome).toBe("failed");
  });

  it("前置不写 await 也不漏中止:结论与写了 await 完全一致(中止后的记录被截断)", async () => {
    const result = await runOnce(scoringAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        scoring: "points",
        test: (async (t: ScoreTestContext) => {
          t.score("早期给分", 5);
          t.check("actual", equals("expected")).gate(); // 没有 await
          t.score("永不执行", 100);
        }) as unknown as DiscoveredEval["test"],
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.verdict).toBe("failed");
    expect(result.scoreEntries).toEqual([{ label: "早期给分", points: 5 }]);
    expect(result.assertions).toHaveLength(1);
  });

  it("计分制丢分不是失败:得分点全挂但没有前置中止时 verdict 仍是 passed", async () => {
    const result = await runOnce(scoringAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        scoring: "points",
        test: (async (t: ScoreTestContext) => {
          // matcher 自带默认 severity 是 gate,计分制里只贡献通过线——不使这条成为前置
          t.check("actual", equals("expected")).points(3);
          t.check("actual", equals("expected"));
        }) as unknown as DiscoveredEval["test"],
      },
    });

    expect(result.verdict).toBe("passed");
    expect(result.assertions.map((a) => a.severity)).toEqual(["soft", "soft"]);
    expect(result.assertions[0]).toMatchObject({ outcome: "failed", points: 0 });
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「超时、缓存与指纹」超时证据保全
// bug: memory/timeout-evidence-carry-censoring-ruling.md
// 契约: docs/runner.md「超时:双层保护」超时不丢证据 —— 中断终止的是「继续执行」,不撤销
// 「已经观察到的事实」。fixture 让第一轮 send 正常完成(留下真实事件/usage),第二轮永远挂起
// (never-resolving promise),外层 timeoutMs 到点后 Effect 中断整段 body:下面分别验证
// events/usage/diff/error.phase 取的是「中断前已收的证据」,而不是从 attempt 开始时的空壳
// base 重建(区分「空壳重建」与「真保全」的关键在于第一轮的事件/usage 是否被观测到)。
describe("runAttemptEffect · 超时证据保全(超时不丢证据,不是从空壳重建)", () => {
  it("中断前已发生的 events/usage 保留;usage 是部分累计值;error.phase 是中断时打开的阶段", async () => {
    vi.useFakeTimers();
    try {
      let sendCalls = 0;
      const agent = defineSandboxAgent({
        name: "fake-agent-timeout",
        send: async () => {
          sendCalls += 1;
          if (sendCalls === 1) {
            return {
              status: "completed" as const,
              events: [{ type: "message" as const, role: "assistant" as const, text: "first turn done" }],
              usage: { inputTokens: 10, outputTokens: 5 },
            };
          }
          // 第二轮永远不返回:模拟 agent 卡死,只能靠外层 timeoutMs 中断。
          return await new Promise<never>(() => {});
        },
      });

      const box = new FakeSandbox();
      const resultPromise = runOnce(agent, box, {
        timeoutMs: 5_000,
        evalDefOverrides: {
          test: async (t) => {
            await t.send("go");
            await t.send("go again"); // 挂起在这里,直到外层超时打断
          },
        },
      });

      // 等第二轮真正发起(第一轮已完成、事件已经进了 SessionManager)再推进虚拟时钟,
      // 确保断言的是「中断前已收到的证据」,不是撞上一个还没来得及产生任何事件的空 attempt。
      await vi.waitFor(() => expect(sendCalls).toBe(2));
      await vi.advanceTimersByTimeAsync(5_100);
      const result = await resultPromise;

      expect(result.verdict).toBe("errored");
      expect(result.error?.code).toBe("timeout");
      // 中断发生在第二轮 send 在飞时,phase 归因到嵌套的 agent.run(不是顶层 eval.run)。
      expect(result.error?.phase).toBe("agent.run");

      // 核心断言:events 非空且确实是第一轮的真实事件,不是空壳重建(base 从不带 events)。
      expect(result.events).toBeDefined();
      expect(result.events!.length).toBeGreaterThan(0);
      expect(result.events!.some((e) => e.type === "message" && e.role === "assistant" && e.text === "first turn done")).toBe(
        true,
      );

      // usage 是已累计轮次的如实值(第一轮的 10/5,不是 0,也不是被后续未完成轮次污染)。
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });

      // sources 照常折叠(即使这份 fixture 的事件不带 loc,字段本身也不能被超时路径漏掉)。
      expect(result.sources).toBeDefined();
      expect(Array.isArray(result.sources)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("沙箱型 attempt 超时:收尾段在 teardown 链前补折叠一次 workspace.diff(diff 字段存在)", async () => {
    vi.useFakeTimers();
    try {
      let sendCalls = 0;
      const agent = defineSandboxAgent({
        name: "fake-agent-timeout-diff",
        send: async () => {
          sendCalls += 1;
          if (sendCalls === 1) {
            return { status: "completed" as const, events: [], usage: { inputTokens: 1, outputTokens: 1 } };
          }
          return await new Promise<never>(() => {});
        },
      });

      const box = new FakeSandbox();
      const resultPromise = runOnce(agent, box, {
        timeoutMs: 5_000,
        evalDefOverrides: {
          test: async (t) => {
            await t.send("go");
            await t.send("go again");
          },
        },
      });

      await vi.waitFor(() => expect(sendCalls).toBe(2));
      await vi.advanceTimersByTimeAsync(5_100);
      const result = await resultPromise;

      expect(result.error?.code).toBe("timeout");
      // diff 字段存在(数组,即便当前 fake 沙箱没有真实 git 状态导致内容为空)——「存在」
      // 而非 undefined 是关键:undefined 才是「沙箱不可用/没走到 workspace.baseline」的如实缺失。
      expect(result.diff).toBeDefined();
      expect(Array.isArray(result.diff)).toBe(true);
      // 补折叠的耗时进了收尾段 phases,不计入主链 durationMs 口径。
      expect(result.phases?.some((p) => p.name === "workspace.diff")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("超时发生在 SandboxSpec.setup 钩子挂起时(从未建立 ledger/session):events/usage/diff 如实缺失,不是伪造空值", async () => {
    vi.useFakeTimers();
    try {
      const agent = defineSandboxAgent({
        name: "fake-agent-early-timeout",
        send: async () => await new Promise<never>(() => {}),
      });

      const box = new FakeSandbox();
      // sandbox.create() 立即成功(内存 fake),但 SandboxSpec.setup 钩子永远不返回:
      // 超时发生在 workspace.baseline 之前,SessionManager/ledger 都还没建立,
      // liveEvents/liveLedger 从未登记过(registerEvidence/registerLedger 都没被调用)。
      const sandboxSpec = defineSandbox({ name: "fake-provider-hang-setup", create: async () => asSandbox(box) }).setup(
        async () => await new Promise<never>(() => {}),
      );
      const run: AgentRun = {
        agent,
        flags: {},
        runs: 1,
        earlyExit: true,
        sandbox: sandboxSpec,
        timeoutMs: 5_000,
        selectedEvalIds: ["fake/eval"],
      };
      const evalDef: DiscoveredEval = {
        id: "fake/eval",
        baseDir: "/project",
        sourcePath: "/project/fake.eval.ts",
        source,
        test: () => {},
      };
      const attempt: Attempt = { evalDef, run, attempt: 0, key: "fake/eval", fingerprint: "" };
      const config: Config = {};
      const runOpts: RunOptions = { config, evals: [evalDef], agentRuns: [run], reporters: [], maxConcurrency: 1 };
      const sandboxSem = Effect.runSync(Effect.makeSemaphore(1));

      const resultPromise = Effect.runPromise(runAttemptEffect(attempt, runOpts, sandboxSem, {}));
      await vi.advanceTimersByTimeAsync(5_100);
      const result = await resultPromise;

      expect(result.error?.code).toBe("timeout");
      expect(result.events).toBeUndefined();
      expect(result.usage).toBeUndefined();
      expect(result.diff).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「ctx.fact() 的作用域归属」
describe("runAttemptEffect · ctx.fact() 的作用域归属落进 EvalResult.facts", () => {
  it("sandbox hook / eval.setup / agent setup·send·teardown 上报的 fact 都落进同一个 attempt 的 facts;同一作用域内同 key 后写覆盖先写", async () => {
    const box = new FakeSandbox();
    const sandboxSpec = defineSandbox({ name: "fake-provider-facts", create: async () => asSandbox(box) })
      .setup(async (_sandbox, ctx) => {
        ctx.fact("sandbox.setup_ran", true);
        ctx.fact("shared.key", "from-sandbox-hook");
      })
      .teardown(async (_sandbox, ctx) => {
        ctx.fact("sandbox.teardown_ran", true);
      });

    const agent = defineSandboxAgent({
      name: "fake-agent-facts",
      setup: async (_sandbox, ctx) => {
        ctx.fact("agent.setup_ran", true);
        ctx.fact("shared.key", "from-agent-setup"); // 覆盖 sandbox hook 写的同 key(同一 attempt 作用域)
      },
      send: async (_input, ctx) => {
        ctx.fact("shared.key", "from-send"); // 再次覆盖:最终值来自最后一次写
        return { events: [], status: "completed" };
      },
      teardown: async (_sandbox, ctx) => {
        ctx.fact("agent.teardown_ran", true);
      },
    });

    const evalDef: DiscoveredEval = {
      id: "fake/eval",
      baseDir: "/project",
      sourcePath: "/project/fake.eval.ts",
      source,
      setup: async (_sandbox, ctx) => {
        ctx.fact("eval.setup_ran", true);
      },
      test: async (t) => {
        await t.send("go");
      },
    };
    const run: AgentRun = {
      agent,
      flags: {},
      runs: 1,
      earlyExit: true,
      sandbox: sandboxSpec,
      timeoutMs: 5_000,
      selectedEvalIds: [evalDef.id],
    };
    const attempt: Attempt = { evalDef, run, attempt: 0, key: "fake/eval", fingerprint: "" };
    const config: Config = {};
    const runOpts: RunOptions = { config, evals: [evalDef], agentRuns: [run], reporters: [], maxConcurrency: 1 };
    const sandboxSem = Effect.runSync(Effect.makeSemaphore(1));

    const result = await Effect.runPromise(runAttemptEffect(attempt, runOpts, sandboxSem, {}));

    expect(result.error).toBeUndefined();
    expect(result.facts).toEqual({
      "sandbox.setup_ran": true,
      "eval.setup_ran": true,
      "agent.setup_ran": true,
      "shared.key": "from-send",
      "agent.teardown_ran": true,
      "sandbox.teardown_ran": true,
    });
  });

  it("没有任何 ctx.fact() 调用时,EvalResult.facts 整个不出现(不是空对象)", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-facts",
      send: async () => ({ events: [], status: "completed" }),
    });
    const result = await runOnce(agent, new FakeSandbox());
    expect(result.error).toBeUndefined();
    expect(result.facts).toBeUndefined();
  });

  it("非法 key(不匹配 [a-z0-9._-]{1,64})抛错:attempt errored,错误信息带上具体 key", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-bad-fact-key",
      send: async () => ({ events: [], status: "completed" }),
    });
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        setup: async (_sandbox, ctx) => {
          ctx.fact("Not A Valid Key!", "x");
        },
      },
    });
    expect(result.verdict).toBe("errored");
    expect(result.error?.phase).toBe("eval.setup");
    expect(result.error?.message).toContain("Not A Valid Key!");
  });

  it("非标量 value(对象)抛错:attempt errored,错误信息带上实际类型", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-bad-fact-value",
      send: async () => ({ events: [], status: "completed" }),
    });
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        setup: async (_sandbox, ctx) => {
          ctx.fact("service.config", { nested: true } as unknown as string);
        },
      },
    });
    expect(result.verdict).toBe("errored");
    expect(result.error?.phase).toBe("eval.setup");
    expect(result.error?.message).toContain("object");
  });
});
