// 变更分类账(私有 git ledger):回答「**agent** 改了什么」,不是「workspace 相对空目录变了什么」。
// 契约见 docs/feature/sandbox/architecture.md「变更归因:send 窗口与分类账」:
// - ledger 的 git 目录在沙箱内、workdir 外(runner 私有路径),以 workdir 为 work-tree——
//   workdir 保持素净:agent 看不到 runner 的 .git,eval 需要真实 git repo 时自己 git init,
//   agent 在 workdir 里的任何 git 操作都碰不到分类账。
// - 三类 commit 时点:锚点一笔(workspace.baseline);每次 t.send() 进入前 workdir 有未记录
//   变化就落一笔 eval 归因;t.send() 返回后落一笔 agent 归因(send 窗口内的全部变化)。
// - 归因排除清单 runner 私有、锚点时冻结:项目自己的 .gitignore 不参与归因判断(add -f 绕过),
//   排除靠 pathspec,include 显式打洞加回。
// - agent 归因增量 = 逐窗口 delta 序列(DiffWindow[]),不做跨窗口压缩。

import type { DiffArtifact, DiffWindow, Sandbox, WindowChange } from "../types.ts";

/** ledger 的私有 git 目录:workdir 之外、runner 控制;agent 的工具默认不会去 /tmp 翻它。 */
const LEDGER_GIT_DIR = "/tmp/.niceeval-ledger";

/** 默认归因排除清单(锚点时冻结):依赖、构建产物、包管理器缓存与 niceeval 自己的落位。 */
const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".niceeval",
  "__niceeval__",
  "coverage",
  ".cache",
  ".pnpm-store",
  ".npm",
  ".yarn",
  "*venv*/",
  ".venv",
  "__pycache__",
];

/** 单个 send 窗口的证据安全上限。越界必须让 workspace.diff 失败,不能产出误导性的空窗口。 */
const MAX_WINDOW_PATHS = 10_000;
const MAX_WINDOW_BLOB_BYTES = 64 * 1024 * 1024;

/**
 * 每个 agent 窗口只发一次 provider 命令:路径枚举与逐 blob 读取都在 sandbox 本地完成。
 * 路径枚举与 blob 读取分别走常数次 git diff / cat-file --batch,不会把文件数放大成子进程或
 * E2B/Vercel 网络往返数。
 */
const EXPORT_WINDOW_SCRIPT = String.raw`node <<'NICEEVAL_LEDGER_EXPORT'
const { spawnSync } = require("node:child_process");

const commit = process.env.NICEEVAL_LEDGER_COMMIT;
const maxPaths = ${MAX_WINDOW_PATHS};
const maxBlobBytes = ${MAX_WINDOW_BLOB_BYTES};
const childMaxBuffer = maxBlobBytes + 1024 * 1024;

function runGit(args, encoding, input) {
  const result = spawnSync("git", args, { encoding, input, maxBuffer: childMaxBuffer });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr || "");
    throw new Error("git " + args[0] + " failed" + (stderr.trim() ? ": " + stderr.trim() : ""));
  }
  return result.stdout;
}

function gitText(args, input) {
  return runGit(args, "utf8", input);
}

function gitBytes(args, input) {
  return runGit(args, null, input);
}

function parseNameStatus(text) {
  const parts = text.split("\0");
  const entries = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (!code) continue;
    const path = parts[i++];
    if (path === undefined) throw new Error("malformed git --name-status output");
    entries.push({ code, path });
  }
  return entries;
}

function parseBinaryPaths(text) {
  const paths = new Set();
  for (const record of text.split("\0")) {
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) throw new Error("malformed git --numstat output");
    if (record.slice(0, firstTab) === "-" && record.slice(firstTab + 1, secondTab) === "-") {
      paths.add(record.slice(secondTab + 1));
    }
  }
  return paths;
}

function parseBatchCheck(text, requests) {
  const lines = text.trimEnd().split("\n");
  if (lines.length !== requests.length) throw new Error("git cat-file --batch-check returned the wrong item count");
  for (let i = 0; i < requests.length; i++) {
    const line = lines[i];
    if (line.endsWith(" missing")) throw new Error("missing ledger blob for " + requests[i].path);
    const fields = line.split(" ");
    const size = Number(fields[fields.length - 1]);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid blob size for " + requests[i].path);
    requests[i].size = size;
  }
}

function applyBatchContents(output, requests) {
  let offset = 0;
  for (const request of requests) {
    const newline = output.indexOf(10, offset);
    if (newline === -1) throw new Error("malformed git cat-file --batch header");
    const header = output.subarray(offset, newline).toString("utf8");
    if (header.endsWith(" missing")) throw new Error("missing ledger blob for " + request.path);
    const fields = header.split(" ");
    const size = Number(fields[fields.length - 1]);
    if (!Number.isSafeInteger(size) || size !== request.size) {
      throw new Error("git cat-file --batch size mismatch for " + request.path);
    }
    const contentStart = newline + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 10) {
      throw new Error("truncated git cat-file --batch content for " + request.path);
    }
    request.change[request.field] = output.subarray(contentStart, contentEnd).toString("utf8");
    offset = contentEnd + 1;
  }
  if (offset !== output.length) throw new Error("unexpected trailing git cat-file --batch output");
}

try {
  if (!commit) throw new Error("missing NICEEVAL_LEDGER_COMMIT");
  const before = commit + "^";
  const entries = parseNameStatus(gitText(["diff", "--no-renames", "--name-status", "-z", before, commit]));
  if (entries.length > maxPaths) {
    throw new Error("niceeval diff window contains " + entries.length + " paths; limit is " + maxPaths);
  }
  const binaryPaths = parseBinaryPaths(gitText(["diff", "--no-renames", "--numstat", "-z", before, commit]));
  const changes = {};
  const requests = [];
  let capturedBytes = 0;

  function reserve(bytes) {
    capturedBytes += bytes;
    if (capturedBytes > maxBlobBytes) {
      throw new Error(
        "niceeval diff window contains more than " + maxBlobBytes + " blob bytes; " +
        "narrow defineEval({ diff }) include/ignore rules"
      );
    }
  }

  for (const entry of entries) {
    if (entry.path.includes("\n")) throw new Error("niceeval diff does not support newline in paths: " + JSON.stringify(entry.path));
    const status = entry.code.startsWith("A")
      ? "added"
      : entry.code.startsWith("D")
        ? "deleted"
        : "modified";
    const change = { status };

    if (binaryPaths.has(entry.path)) {
      const binary = {};
      if (status !== "added") {
        requests.push({ spec: before + ":" + entry.path, path: entry.path, field: "beforeBytes", binary, change, isBinary: true });
      }
      if (status !== "deleted") {
        requests.push({ spec: commit + ":" + entry.path, path: entry.path, field: "afterBytes", binary, change, isBinary: true });
      }
      change.binary = binary;
    } else {
      if (status !== "added") {
        requests.push({ spec: before + ":" + entry.path, path: entry.path, field: "before", change, isBinary: false });
      }
      if (status !== "deleted") {
        requests.push({ spec: commit + ":" + entry.path, path: entry.path, field: "after", change, isBinary: false });
      }
    }
    changes[entry.path] = change;
  }

  if (requests.length > 0) {
    const requestInput = requests.map((request) => request.spec).join("\n") + "\n";
    parseBatchCheck(gitText(["cat-file", "--batch-check"], requestInput), requests);
    for (const request of requests) {
      reserve(request.size);
      if (request.isBinary) request.binary[request.field] = request.size;
    }
    const textRequests = requests.filter((request) => !request.isBinary);
    if (textRequests.length > 0) {
      const textInput = textRequests.map((request) => request.spec).join("\n") + "\n";
      applyBatchContents(gitBytes(["cat-file", "--batch"], textInput), textRequests);
    }
  }

  process.stdout.write(JSON.stringify(changes));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
NICEEVAL_LEDGER_EXPORT`;

export interface ChangeLedger {
  /** send 进入前:workdir 有未记录变化就落一笔 eval 归因(fixture / setup / runCommand 副作用)。 */
  commitEvalWindow(label: string): Promise<void>;
  /** send 返回后:落一笔 agent 归因——这个 send 窗口内的全部 workspace 变化(无变化也落空窗口)。 */
  commitAgentWindow(label: string): Promise<void>;
  /** workspace.diff 阶段:从分类账导出每个 send 窗口自己的 before/after,按时序。 */
  exportWindows(): Promise<DiffArtifact>;
}

interface LedgerOptions {
  /** defineEval({ diff }) 的归因调整:ignore 追加排除,include 打洞加回(优先级最高)。 */
  include?: string[];
  ignore?: string[];
}

/** 每条 git 命令都带上私有 GIT_DIR + workdir work-tree;项目/全局 gitignore 一律不参与。 */
function gitEnv(sandbox: Sandbox): Record<string, string> {
  return {
    GIT_DIR: LEDGER_GIT_DIR,
    GIT_WORK_TREE: sandbox.workdir,
    GIT_AUTHOR_NAME: "niceeval",
    GIT_AUTHOR_EMAIL: "niceeval@localhost",
    GIT_COMMITTER_NAME: "niceeval",
    GIT_COMMITTER_EMAIL: "niceeval@localhost",
    HOME: "/tmp",
  };
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/** 打分类账锚点(workspace.baseline 阶段,环境层钩子之后):git init + 冻结排除清单 + 首笔 commit。 */
export async function createChangeLedger(sandbox: Sandbox, opts?: LedgerOptions): Promise<ChangeLedger> {
  const excludes = [...DEFAULT_EXCLUDES, ...(opts?.ignore ?? [])];
  const includes = opts?.include ?? [];
  const env = gitEnv(sandbox);

  // add -A -f:绕过项目自己的 .gitignore(项目 ignore 的文件照常记录);排除靠 pathspec
  // (runner 私有清单,agent / fixture 写 .gitignore 影响不了它);include 用第二次 add 打洞加回。
  const excludeSpecs = excludes.map((e) => shellQuote(`:(exclude)${e}`)).join(" ");
  // include 打洞:路径此刻可能还不存在(如 agent 之后才写),unmatched pathspec 不算错。
  const includeAdd =
    includes.length > 0 ? ` && { git add -A -f -- ${includes.map(shellQuote).join(" ")} 2>/dev/null || true; }` : "";
  const addAll = `git add -A -f -- . ${excludeSpecs}${includeAdd}`;

  const anchor = await sandbox.runShell(`git init -q "${LEDGER_GIT_DIR}" && ${addAll} && git commit -q --allow-empty -m "anchor"`, {
    env,
  });
  ensureCommandSucceeded(anchor, "create change ledger anchor");

  return {
    async commitEvalWindow(label: string): Promise<void> {
      // 有未记录变化才落这一笔;干净时不产生空的 eval 归因 commit。
      const result = await sandbox.runShell(`${addAll} && (git diff --cached --quiet || git commit -q -m ${shellQuote(`eval ${label}`)})`, {
        env,
      });
      ensureCommandSucceeded(result, `commit eval window ${label}`);
    },
    async commitAgentWindow(label: string): Promise<void> {
      // 窗口内没有变化时也落一条(--allow-empty),diff.json 里该窗口 changes 为空对象。
      const result = await sandbox.runShell(`${addAll} && git commit -q --allow-empty -m ${shellQuote(`agent ${label}`)}`, { env });
      ensureCommandSucceeded(result, `commit agent window ${label}`);
    },
    async exportWindows(): Promise<DiffArtifact> {
      return exportAgentWindows(sandbox, env);
    },
  };
}

async function exportAgentWindows(sandbox: Sandbox, env: Record<string, string>): Promise<DiffArtifact> {
  const windows: DiffWindow[] = [];
  const logResult = await sandbox.runShell(`git log --reverse --format='%H %s'`, { env });
  ensureCommandSucceeded(logResult, "read change ledger");
  const log = logResult.stdout;
  const commits = log
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(" ");
      return { hash: line.slice(0, space), subject: line.slice(space + 1) };
    });

  for (const commit of commits) {
    if (!commit.subject.startsWith("agent ")) continue;
    const label = commit.subject.slice("agent ".length);
    const result = await sandbox.runShell(EXPORT_WINDOW_SCRIPT, {
      env: { ...env, NICEEVAL_LEDGER_COMMIT: commit.hash },
    });
    ensureCommandSucceeded(result, `export diff window ${label}`);
    const changes = parseWindowChanges(result.stdout, label);
    windows.push({ window: label, changes });
  }
  return windows;
}

function ensureCommandSucceeded(result: { exitCode: number; stderr: string }, operation: string): void {
  if (result.exitCode === 0) return;
  const detail = result.stderr.trim().split("\n")[0];
  throw new Error(`${operation} failed (exit ${result.exitCode})${detail ? `: ${detail}` : ""}`);
}

function parseWindowChanges(text: string, label: string): Record<string, WindowChange> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`export diff window ${label} returned invalid JSON`, { cause: error });
  }
  if (!isRecord(parsed)) throw new Error(`export diff window ${label} returned a non-object payload`);

  const changes: Record<string, WindowChange> = {};
  for (const [path, raw] of Object.entries(parsed)) changes[path] = parseWindowChange(raw, label, path);
  return changes;
}

function parseWindowChange(raw: unknown, label: string, path: string): WindowChange {
  if (!isRecord(raw)) throw invalidWindowChange(label, path);
  const status = raw.status;
  if (status !== "added" && status !== "modified" && status !== "deleted") throw invalidWindowChange(label, path);
  const change: WindowChange = { status };
  if (raw.before !== undefined) {
    if (typeof raw.before !== "string") throw invalidWindowChange(label, path);
    change.before = raw.before;
  }
  if (raw.after !== undefined) {
    if (typeof raw.after !== "string") throw invalidWindowChange(label, path);
    change.after = raw.after;
  }
  if (raw.binary !== undefined) {
    if (!isRecord(raw.binary)) throw invalidWindowChange(label, path);
    const binary: NonNullable<WindowChange["binary"]> = {};
    if (raw.binary.beforeBytes !== undefined) {
      if (!isNonNegativeInteger(raw.binary.beforeBytes)) throw invalidWindowChange(label, path);
      binary.beforeBytes = raw.binary.beforeBytes;
    }
    if (raw.binary.afterBytes !== undefined) {
      if (!isNonNegativeInteger(raw.binary.afterBytes)) throw invalidWindowChange(label, path);
      binary.afterBytes = raw.binary.afterBytes;
    }
    change.binary = binary;
  }
  return change;
}

function invalidWindowChange(label: string, path: string): Error {
  return new Error(`export diff window ${label} returned an invalid change for ${JSON.stringify(path)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
