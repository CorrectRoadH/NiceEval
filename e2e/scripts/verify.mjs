#!/usr/bin/env node
// e2e 的"真正的测试"(docs/e2e-ci.md 第 5 节):把 niceeval CLI 当黑盒子进程跑,
// 对照期望表校验退出码 + summary.json。eval 只是 fixture,判红判绿的责任在这里。
//
// 前置:e2e/apps 下对应的被测应用已经在跑(CI workflow 或本地开发者自己起,eval 不代管进程)。
// 用法:node e2e/scripts/verify.mjs [项目名过滤,如 ai-sdk-v7]
import { spawn } from "node:child_process";
import { readdir, readFile, stat, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect } from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const e2eRoot = join(here, "..");
const repoRoot = join(e2eRoot, "..");
const BIN = join(repoRoot, "bin", "niceeval.js");

// 期望表:每行 = 一次 CLI 调用。evals = 按 profile 算出的期望 eval 数(防"少排用例还全绿",
// 见 docs/e2e-ci.md 3.1"防静默失配");ci 期望全绿 exit 0,verdicts 期望 exit 1 且一红一炸。
const PLAN = [
  { project: "ai-sdk-v7",  exp: "ci",       port: 34001, expectExit: 0, evals: 5, allPass: true },
  { project: "ai-sdk-v7",  exp: "verdicts", port: 34001, expectExit: 1, evals: 2, failedAtLeast: 1, erroredAtLeast: 1 },
  { project: "pi-sdk",     exp: "ci",       port: 33001, expectExit: 0, evals: 5, allPass: true },
  { project: "claude-sdk", exp: "ci",       port: 32001, expectExit: 0, evals: 5, allPass: true },
  { project: "langgraph",  exp: "ci",       port: 35000, expectExit: 0, evals: 5, allPass: true },
  { project: "codex-sdk",  exp: "ci",       port: 31001, expectExit: 0, evals: 4, allPass: true },
];

function portUp(port) {
  return new Promise((resolve) => {
    const sock = connect({ port, host: "127.0.0.1" }, () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
    sock.setTimeout(1500, () => { sock.destroy(); resolve(false); });
  });
}

function runCli(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, stdio: ["ignore", "inherit", "inherit"] });
    child.on("close", (code) => resolve(code ?? 2));
  });
}

async function latestSummary(projectDir) {
  const outRoot = join(projectDir, ".niceeval");
  const found = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name === "summary.json") found.push(p);
    }
  }
  await walk(outRoot);
  if (found.length === 0) return null;
  const stats = await Promise.all(found.map(async (p) => ({ p, mtime: (await stat(p)).mtimeMs })));
  stats.sort((a, b) => b.mtime - a.mtime);
  return { path: stats[0].p, summary: JSON.parse(await readFile(stats[0].p, "utf8")) };
}

const filter = process.argv[2];
const failures = [];
let ran = 0;

for (const row of PLAN) {
  if (filter && row.project !== filter) continue;
  ran++;
  const tag = `${row.project}/${row.exp}`;
  const projectDir = join(e2eRoot, "projects", row.project);

  if (!(await portUp(row.port))) {
    failures.push(`${tag}: app 未就绪(127.0.0.1:${row.port} 连不上)。先起 e2e/apps/${row.project} 再跑。`);
    continue;
  }

  console.log(`\n=== ${tag} (expect exit ${row.expectExit}) ===`);
  const startedAt = Date.now();
  const exit = await runCli(projectDir, ["exp", row.exp, "--force"]);
  if (exit !== row.expectExit) {
    failures.push(`${tag}: exit ${exit},期望 ${row.expectExit}`);
  }

  const latest = await latestSummary(projectDir);
  if (!latest) { failures.push(`${tag}: 找不到 summary.json`); continue; }
  const { path: summaryPath, summary } = latest;
  if ((await stat(summaryPath)).mtimeMs < startedAt) {
    failures.push(`${tag}: summary.json 不是本次运行产出的(--force 失效或运行没落盘?)`);
    continue;
  }

  // 工件格式契约(只查形状,不钉版本值)
  for (const field of ["format", "schemaVersion", "producer", "passed", "failed", "errored", "results"]) {
    if (summary[field] === undefined) failures.push(`${tag}: summary.json 缺字段 ${field}`);
  }

  // 按 profile 对账 eval 数:results 按 attempt 计,数去重后的 eval id
  const ids = new Set((summary.results ?? []).map((r) => r.id));
  if (ids.size !== row.evals) {
    failures.push(`${tag}: 发现 ${ids.size} 条 eval(${[...ids].join(", ")}),期望 ${row.evals} 条`);
  }

  if (row.allPass && (summary.failed > 0 || summary.errored > 0)) {
    failures.push(`${tag}: failed=${summary.failed} errored=${summary.errored},期望全绿`);
  }
  if (row.failedAtLeast && summary.failed < row.failedAtLeast) {
    failures.push(`${tag}: failed=${summary.failed},期望 ≥ ${row.failedAtLeast}`);
  }
  if (row.erroredAtLeast && summary.errored < row.erroredAtLeast) {
    failures.push(`${tag}: errored=${summary.errored},期望 ≥ ${row.erroredAtLeast}`);
  }

  // 抽查一个 attempt 工件目录真实存在
  const withDir = (summary.results ?? []).find((r) => r.artifactsDir);
  if (withDir) {
    try { await access(join(dirname(summaryPath), withDir.artifactsDir)); }
    catch {
      try { await access(withDir.artifactsDir); }
      catch { failures.push(`${tag}: results[].artifactsDir 指向不存在的目录: ${withDir.artifactsDir}`); }
    }
  }
}

console.log(`\n${"=".repeat(60)}`);
if (ran === 0) {
  console.error(`没有匹配 "${filter}" 的计划行`);
  process.exit(2);
}
if (failures.length) {
  console.error(`verify FAILED(${failures.length} 处):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`verify OK:${ran} 次 CLI 调用全部符合期望。`);
