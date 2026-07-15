// 留存沙箱的持久注册表:`.niceeval/sandboxes/` 下的逐条目文件(不是多个 attempt 竞争改写的
// 一份 JSON)。entry id 由 provider + sandboxId 做稳定散列;每条先写同目录临时文件、fsync 文件后
// rename 成 <entry-id>.json,再 fsync 目录——不同 attempt 与不同 niceeval 进程不会覆盖彼此。
// 契约见 docs/feature/sandbox/architecture.md「留存(keep)与注册表」。

import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Verdict } from "../types.ts";

/** 一条留存登记项(逐条目文件的 JSON 形状)。 */
export interface KeptSandboxEntry {
  sandboxId: string;
  provider: string;
  evalId: string;
  attempt: number;
  experimentId?: string;
  locator: string;
  verdict: Verdict;
  keptAt: string;
  workdir: string;
  /** provider 原生的进入命令(直连与审计用);日常入口是 `niceeval sandbox enter`。 */
  enter?: string;
  /** 现场可找回的截止时刻——provider 声明了保留期限才写(vercel 写,e2b pause 无限期保留则不写)。 */
  expiresAt?: string;
  /** alive = 实例在跑(suspend 失败或 --leave-running);dormant = 休眠可唤醒;expired = 现场已没了。 */
  state: "alive" | "dormant" | "expired";
  /** 事后命令的条目级互斥凭据(enter 持有;stop 与另一个 enter 对同一条目直接拒绝)。 */
  lease?: { holder: string; op: string; acquiredAt: string; ttlMs: number };
}

/** entry id:provider + sandboxId 的稳定散列(条目文件名)。 */
export function keptEntryId(provider: string, sandboxId: string): string {
  return createHash("sha256").update(`${provider}\n${sandboxId}`).digest("hex").slice(0, 12);
}

export function sandboxesDirOf(niceevalRoot: string): string {
  return join(niceevalRoot, "sandboxes");
}

/**
 * 注册表发现:从 cwd 向上找最近的 `.niceeval/`(与结果根发现同一规则)。
 * 找不到返回 undefined,调用方报错并提示 `--run <结果根>`。
 */
export async function findNiceevalRoot(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);
  for (;;) {
    const candidate = join(current, ".niceeval");
    try {
      const entries = await readdir(candidate);
      void entries;
      return candidate;
    } catch {
      // 不存在,继续向上
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** 原子写入一条登记项:临时文件 → fsync → rename → fsync 目录。 */
export async function writeKeptEntry(niceevalRoot: string, entry: KeptSandboxEntry): Promise<void> {
  const dir = sandboxesDirOf(niceevalRoot);
  await mkdir(dir, { recursive: true });
  const id = keptEntryId(entry.provider, entry.sandboxId);
  const tmpPath = join(dir, `.${id}.${process.pid}.tmp`);
  const finalPath = join(dir, `${id}.json`);
  const handle = await open(tmpPath, "w");
  try {
    await handle.writeFile(JSON.stringify(entry, null, 2), "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, finalPath);
  await fsyncDir(dir);
}

/** 读全部登记项(坏条目跳过并记名,不整体失败)。 */
export async function readKeptEntries(
  niceevalRoot: string,
): Promise<{ entries: { id: string; entry: KeptSandboxEntry }[]; malformed: string[] }> {
  const dir = sandboxesDirOf(niceevalRoot);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return { entries: [], malformed: [] };
  }
  const entries: { id: string; entry: KeptSandboxEntry }[] = [];
  const malformed: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      entries.push({ id: file.slice(0, -".json".length), entry: JSON.parse(raw) as KeptSandboxEntry });
    } catch {
      malformed.push(file);
    }
  }
  entries.sort((a, b) => a.entry.keptAt.localeCompare(b.entry.keptAt));
  return { entries, malformed };
}

/** 更新一条登记项(读-改-原子写;字段浅合并)。条目不存在时静默返回 false。 */
export async function updateKeptEntry(
  niceevalRoot: string,
  id: string,
  patch: Partial<KeptSandboxEntry> | ((entry: KeptSandboxEntry) => KeptSandboxEntry),
): Promise<boolean> {
  const path = join(sandboxesDirOf(niceevalRoot), `${id}.json`);
  let entry: KeptSandboxEntry;
  try {
    entry = JSON.parse(await readFile(path, "utf-8")) as KeptSandboxEntry;
  } catch {
    return false;
  }
  const next = typeof patch === "function" ? patch(entry) : { ...entry, ...patch };
  await writeKeptEntry(niceevalRoot, next);
  return true;
}

/** 删除一条登记项并同步目录(只在实例成功销毁或确认已不存在后调用)。 */
export async function removeKeptEntry(niceevalRoot: string, id: string): Promise<void> {
  const dir = sandboxesDirOf(niceevalRoot);
  await rm(join(dir, `${id}.json`), { force: true });
  await fsyncDir(dir);
}

async function fsyncDir(dir: string): Promise<void> {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // 平台不支持目录 fsync(如 Windows)时静默降级;rename 本身已是原子替换。
  }
}
