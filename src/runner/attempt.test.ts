// 路径提升单测:agent.setup 写进沙箱 `__niceeval__/agent-setup.json` 的安装 manifest,
// runAttemptEffect 在 setup 之后把它读出来、原样挂到 EvalResult.agentSetup(见
// docs/feature/results/architecture.md「agent-setup.json」、src/agents/manifest.ts 的注释)。
// 沙箱是内存 fake(记文件,不起容器)——这里要验的是运行器自己「何时读、读到什么、读不到
// 怎么办」这段编排逻辑,不是 adapter 侧的 manifest 构造规则(那部分已在 agents/skills.test.ts
// 覆盖)。

import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { runAttemptEffect } from "./attempt.ts";
import { defineSandboxAgent, defineSandbox } from "../define.ts";
import { writeAgentSetupManifest, AGENT_SETUP_MANIFEST_PATH } from "../agents/manifest.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type { Attempt, AgentRun, RunOptions } from "./types.ts";
import type {
  AgentSetupManifest,
  Agent,
  CommandResult,
  Config,
  DiscoveredEval,
  Sandbox,
  SandboxFile,
} from "../types.ts";

/** 内存沙箱:writeFiles/readFile 记文件,runShell 恒成功(供 initGitAndCommit / diff 采集用)。 */
class FakeSandbox implements Partial<Sandbox> {
  readonly workdir = "/workspace";
  readonly sandboxId = "fake";
  readonly otlpHost = null;
  readonly files = new Map<string, string>();

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
  async readSourceFiles(): Promise<never> {
    throw new Error("not implemented");
  }
  async stop(): Promise<void> {}
}

const asSandbox = (box: FakeSandbox): Sandbox => box as unknown as Sandbox;

const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };

/** 跑一次 attempt:给定 agent,返回 EvalResult。沙箱用内存 fake,不起容器/不联网。 */
async function runOnce(agent: Agent, box: FakeSandbox): Promise<import("../types.ts").EvalResult> {
  const evalDef: DiscoveredEval = {
    id: "fake/eval",
    baseDir: "/project",
    sourcePath: "/project/fake.eval.ts",
    source,
    test: () => {},
  };
  const run: AgentRun = {
    agent,
    flags: {},
    runs: 1,
    earlyExit: true,
    // 自定义 provider:create() 直接返回内存 fake,绕开真实沙箱 provider。
    sandbox: defineSandbox({ name: "fake-provider", create: async () => asSandbox(box) }),
    timeoutMs: 5_000,
    evalFilter: () => true,
  };
  const attempt: Attempt = { evalDef, run, attempt: 0, key: "fake/eval", fingerprint: "" };
  const config: Config = {};
  const opts: RunOptions = {
    config,
    evals: [evalDef],
    agentRuns: [run],
    reporters: [],
    maxConcurrency: 1,
    onProgress: () => {}, // 静音进度日志,不污染测试输出
  };
  const sandboxSem = Effect.runSync(Effect.makeSemaphore(1));
  return Effect.runPromise(runAttemptEffect(attempt, opts, sandboxSem));
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
