// e2e 回归:CLI 输出两形态(人读文本 + `--json`)机制自身的验收(见 docs/feature/experiments/cli.md
// 与 memory/exp-output-two-forms-ruling.md)。这里把能在非 TTY 子进程里确定性复现的部分转成
// spawn 级测试:
//   - `--json` 全程无 ANSI(byte-level ESC 扫描,不是字符串包含检查),stdout 收到可逐行
//     JSON.parse 的 NDJSON 事件流,首行 `start` 带 `format`/`schemaVersion`,末行 `result`;
//     `stderr` 完全为空(正常事件全部走 stdout 单一有序流,不分流)。
//   - 不加 flag(非 TTY 管道天然如此,不需要伪造)退化为人读文本的纯追加流:零 ANSI,
//     从 start 到结束摘要单一有序落在 `stdout`,`stderr` 完全为空——不偷偷切换成 `--json` 语义。
//   - `--output`(任何取值,含裸 flag)是用法错误:非零退出、`error:`/`fix:` 两行、不运行。
//   - `--dry` 在两种形态下都不创建 `.niceeval` 快照目录,也不写 `--junit`;`--dry --json`
//     输出单个 JSON 计划文档(不是事件流)。
//   - `--quiet` 报未知 flag 错误、非零退出(`--quiet` 不存在,不是第三种反馈模式)。
//
// 矩阵里唯一没有自动化覆盖的一行是「人读文本在真实/伪 TTY 中动态覆盖」——判断 isTTY 依赖真实
// 终端设备,子进程管道(`stdio: "pipe"`)天然是非 TTY,Node 没有内置 API 能在不引入原生 pty
// 依赖(如 node-pty)的前提下伪造 `isTTY: true`;这一行继续依赖人工验证。
//
// 全程不联网、不起沙箱:fixture 用一个 remote kind 的 mock agent,秒回固定文本、恒定通过。

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const fixtureDir = join(here, "fixtures", "cli-output-profiles");
const cliEntry = join(repoRoot, "bin", "niceeval.js");

function cleanEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  // 固定英文:人读文本走 i18n,固定 NICEEVAL_LANG 让这里的字符串断言不随开发机 locale 漂移。
  return { ...process.env, NICEEVAL_LANG: "en", ...overrides };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], { cwd: fixtureDir, env, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const ESC = "\x1b";
/** byte-level 扫描,不是"看起来像不像颜色码"的字符串启发式——只要出现 ESC(0x1b)就判定为
 *  含 ANSI/光标控制,`--json`、非 TTY 人读文本两者都不允许出现。 */
function hasAnsi(text: string): boolean {
  return text.includes(ESC);
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

const niceevalDir = join(fixtureDir, ".niceeval");

beforeEach(async () => {
  await rm(niceevalDir, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(niceevalDir, { recursive: true, force: true });
});

test("--json:全程无 ANSI,stdout 收到可逐行 JSON.parse 的事件流,stderr 完全为空", async () => {
  const { code, stdout, stderr } = await runCli(["exp", "--force", "--json"], cleanEnv());
  expect(code).toBe(0);
  expect(hasAnsi(stdout)).toBe(false);
  expect(stderr).toBe("");
  const lines = stdout.trim().split("\n").filter(Boolean);
  expect(lines.length).toBeGreaterThan(0);
  const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(events[0]).toMatchObject({ format: "niceeval.exp", schemaVersion: 1, event: "start" });
  const last = events.at(-1)!;
  expect(last).toMatchObject({ event: "result", status: "passed" });
});

test("不加 flag(非 TTY 管道)退化为人读文本纯追加流:无 ANSI,单一 stdout 流,stderr 为空", async () => {
  const { code, stdout, stderr } = await runCli(["exp", "--force"], cleanEnv());
  expect(code).toBe(0);
  expect(hasAnsi(stdout)).toBe(false);
  expect(stderr).toBe("");
  // 真正的 human 文案(大写 PASSED,来自 feedback.human.resultPassed),不是被 TTY 检测
  // 失败就静默切换成 --json 的输出形状。
  expect(stdout).toContain("PASSED");
  expect(stdout).not.toContain('"event":"result"');
});

test(
  "--output(任何取值)是用法错误:error:/fix: 两行,非零退出,不运行",
  async () => {
    const bare = await runCli(["exp", "--force", "--output"], cleanEnv());
    expect(bare.code).not.toBe(0);
    expect(bare.stderr).toContain("error: unknown option '--output'");
    expect(bare.stderr).toContain("fix:");
    expect(bare.stdout).toBe("");
    expect(await pathExists(niceevalDir)).toBe(false);

    const withValue = await runCli(["exp", "--force", "--output", "agent"], cleanEnv());
    expect(withValue.code).not.toBe(0);
    expect(withValue.stderr).toContain("error: unknown option '--output'");

    const equalsForm = await runCli(["exp", "--force", "--output=ci"], cleanEnv());
    expect(equalsForm.code).not.toBe(0);
    expect(equalsForm.stderr).toContain("error: unknown option '--output'");
  },
  // 三次顺序 spawn(而不是文件里其它测试的单次 spawn),在共享/负载较高的机器上单个默认
  // 5s 超时不够;这三次 spawn 在 --output 预扫阶段就直接退出,不实际起 eval,正常耗时很短,
  // 放宽超时只是给系统争抢让路,不代表这条路径本身变慢。
  15_000,
);

test("exp 选择存在但 eval pattern 匹配 0 条时明确报错且不创建结果", async () => {
  const { code, stdout, stderr } = await runCli(["exp", "basic", "does-not-exist"], cleanEnv());
  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toContain("No evals selected");
  expect(stderr).toContain("matched 0 evals");
  expect(stderr).toContain("Available eval prefixes: basic");
  expect(await pathExists(niceevalDir)).toBe(false);
});

test.each(["show", "view"])("exp %s 误把顶层查看命令当 experiment 时给出纠错提示", async (command) => {
  const { code, stdout, stderr } = await runCli(["exp", command], cleanEnv());
  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toContain(`No experiment matched: ${command}`);
  expect(stderr).toContain(`Did you mean: niceeval ${command}`);
  expect(await pathExists(niceevalDir)).toBe(false);
});

test("exp 拒绝 show/view 专用 flag(--history):非零退出 + 明确用法错误,不静默忽略也不真的跑", async () => {
  const { code, stdout, stderr } = await runCli(["exp", "--history"], cleanEnv());
  expect(code).toBe(1);
  expect(stderr).toContain("`--history` only applies to niceeval show");
  // 没有静默吞掉后当成一次正常运行:不产生任何形态的结果收尾内容。
  expect(stdout).not.toContain('"event":"result"');
  expect(stdout).not.toContain("PASSED");
  expect(stdout).not.toContain("FAILED");
});

test("--timing mode 严格解析:未知 mode 直接报枚举用法错误", async () => {
  const invalid = await runCli(["show", "--timing=verbose"], cleanEnv());
  expect(invalid.code).toBe(1);
  expect(invalid.stderr).toContain('--timing only accepts "summary" (default) or "full"');
});

// --dry 的副作用闸门与输出形态正交(核心路径无形态分支),两种形态各代表一次。
test("--dry:不创建 .niceeval 快照目录,也不写 --junit(人读文本)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "niceeval-dry-"));
  try {
    const junitPath = join(tmp, "out.xml");
    const { code, stdout } = await runCli(["exp", "--dry", "--junit", junitPath], cleanEnv());
    expect(code).toBe(0);
    expect(hasAnsi(stdout)).toBe(false);
    expect(await pathExists(niceevalDir)).toBe(false);
    expect(await pathExists(junitPath)).toBe(false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("--dry --json:输出单个 ExpPlanDocument(不是事件流),不创建 .niceeval,也不写 --junit", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "niceeval-dry-json-"));
  try {
    const junitPath = join(tmp, "out.xml");
    const { code, stdout, stderr } = await runCli(["exp", "--dry", "--json", "--junit", junitPath], cleanEnv());
    expect(code).toBe(0);
    expect(hasAnsi(stdout)).toBe(false);
    expect(stderr).toBe("");
    const lines = stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1); // 一次完成的读取,不是逐行事件流
    const doc = JSON.parse(lines[0]!);
    expect(doc.format).toBe("niceeval.exp-plan");
    expect(Array.isArray(doc.matrix)).toBe(true);
    expect(await pathExists(niceevalDir)).toBe(false);
    expect(await pathExists(junitPath)).toBe(false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("--quiet 报未知 flag 错误并非零退出(不是第三种反馈模式,不存在)", async () => {
  const { code, stderr } = await runCli(["exp", "--quiet"], cleanEnv());
  expect(code).not.toBe(0);
  expect(stderr.toLowerCase()).toContain("quiet");
});
