// 结果 loader:发现并读取 summary.json,做版本判定与 normalize,不做任何聚合/渲染。
// 设计见 docs/view.md「结果版本机制」:先 normalize 再渲染;目录扫描不让单个坏 run 拖垮整页,
// 但「像报告却读不了/版本不同」的 run 必须记入 skipped,不许无声消失。

import { existsSync, statSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type RunSummary } from "../types.ts";
import type { ViewEvalResult } from "./shared/types.ts";
import { t } from "../i18n/index.ts";

export interface LoadedSummary {
  path: string;
  summary: RunSummary;
}

/** schemaVersion 与当前 CLI 不同、按设计直接不兼容的 run;只占位提示,不解析内容。 */
export interface IncompatibleRun {
  /** run 目录(summary.json 所在目录),相对 cwd;直接可拼进 npx 命令。 */
  dir: string;
  schemaVersion: number;
  producerVersion?: string;
}

/** 目录扫描里被跳过、但必须让用户知道的 run(版本不同 / 像报告却损坏)。 */
export interface SkippedRun {
  /** summary.json 路径,相对 cwd。 */
  path: string;
  /** run 目录,相对 cwd。 */
  dir: string;
  reason: "incompatible-version" | "malformed";
  schemaVersion?: number;
  producerVersion?: string;
  /** incompatible-version:拼好的 npx 查看命令。 */
  command?: string;
  /** malformed:一句诊断。 */
  detail?: string;
}

export interface ScanResult {
  loaded: LoadedSummary[];
  skipped: SkippedRun[];
  /**
   * artifactBase(相对 view 根)→ 宿主机绝对目录。只在 server 端内存里保留;
   * 绝对路径不进 viewData,避免序列化进可分享的静态 HTML(信息泄漏且浏览器端用不到)。
   */
  artifactDirs: Map<string, string>;
}

/** 用能读这份报告的 niceeval 版本查看的命令。 */
export function incompatibleViewCommand(run: IncompatibleRun): string {
  return `npx niceeval@${run.producerVersion ?? "<version>"} view ${run.dir}`;
}

/** 版本不匹配的完整提示文案;CLI 单文件模式和目录扫描占位共用。 */
export function incompatibleHint(run: IncompatibleRun): string {
  return t("cli.view.incompatible", {
    dir: run.dir,
    producer: run.producerVersion ?? "?",
    schemaVersion: run.schemaVersion,
    supported: RESULTS_SCHEMA_VERSION,
    command: incompatibleViewCommand(run),
  });
}

/** 单文件模式读到版本不同的 summary 时抛出;CLI 捕获后打印提示退出,不当成普通错误堆栈。 */
export class IncompatibleResultsError extends Error {
  constructor(readonly run: IncompatibleRun) {
    super(incompatibleHint(run));
    this.name = "IncompatibleResultsError";
  }
}

/** 像 niceeval 报告但读不了(JSON 损坏 / 必需字段坏);目录扫描记入 skipped,单文件模式直接失败。 */
export class MalformedResultsError extends Error {
  constructor(readonly path: string, readonly detail: string) {
    super(`${path}: ${detail}. The report may be corrupted; re-run the eval or delete this run directory.`);
    this.name = "MalformedResultsError";
  }
}

/** 不是 niceeval 报告的无关 JSON;目录扫描静默忽略,单文件模式直接失败。 */
export class NotAReportError extends Error {
  constructor(path: string) {
    super(`${path} is not a niceeval summary`);
    this.name = "NotAReportError";
  }
}

/** 读最近一次运行的所有 EvalResult，供 --resume 跳过已通过的 eval。 */
export async function loadMostRecentResults(root = ".niceeval"): Promise<EvalResult[]> {
  const { loaded } = await loadSummaries(root);
  // loadSummaries 已按 startedAt 降序，第一个是最新的
  return loaded[0]?.summary.results ?? [];
}

/** 服务/解析工件的根目录:输入是目录就用它,是文件就用其所在目录。 */
export function viewRoot(input?: string): string {
  const target = resolve(input ?? ".niceeval");
  try {
    return statSync(target).isFile() ? dirname(target) : target;
  } catch {
    return target;
  }
}

export async function loadSummaries(input?: string): Promise<ScanResult> {
  const target = resolve(input ?? ".niceeval");
  const artifactDirs = new Map<string, string>();
  if (!existsSync(target)) return { loaded: [], skipped: [], artifactDirs };
  const root = viewRoot(input);
  const s = await stat(target);
  if (s.isFile()) {
    // 单文件模式:这是用户明确指定的目标,任何读不了(版本/损坏/无关)都直接抛,由 CLI 打印提示退出。
    const summary = normalizeSummary(await parseSummary(target), target);
    return { loaded: [{ path: target, summary: withViewRefs(summary, target, root, artifactDirs) }], skipped: [], artifactDirs };
  }

  const candidates = await findSummaryFiles(target);
  const loaded: LoadedSummary[] = [];
  const skipped: SkippedRun[] = [];
  for (const path of candidates) {
    try {
      const summary = normalizeSummary(await parseSummary(path), path);
      loaded.push({ path, summary: withViewRefs(summary, path, root, artifactDirs) });
    } catch (e) {
      const entry = classifySkip(e, path);
      // 无关 JSON(NotAReportError)可以静默忽略;像报告却读不了的必须记下来。
      if (entry) skipped.push(entry);
    }
  }
  loaded.sort((a, b) => b.summary.startedAt.localeCompare(a.summary.startedAt));
  // run 目录名是时间戳,降序 ≈ 最新在前。
  skipped.sort((a, b) => b.dir.localeCompare(a.dir));
  return { loaded, skipped, artifactDirs };
}

/** 只做 IO:读文件 + JSON.parse。解析失败按「可能损坏的报告」处理(文件名就叫 summary.json)。 */
export async function parseSummary(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (e) {
    throw new MalformedResultsError(path, `cannot read file (${e instanceof Error ? e.message : String(e)})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MalformedResultsError(path, "invalid JSON");
  }
}

/**
 * 版本判定与形状校验,把磁盘 JSON 收成 view 内部统一模型:
 * - 带 format 信封:format 不是 niceeval.results → 无关 JSON;schemaVersion 与当前不同 → 不兼容,
 *   不解析、不迁移、不降级渲染(缺 schemaVersion 的早期信封按 1 处理)。
 * - 无信封:有 results[] + startedAt 按 legacy v0 照读(未知字段忽略);连报告痕迹都没有 → 无关 JSON。
 */
export function normalizeSummary(raw: unknown, path: string): RunSummary {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MalformedResultsError(path, "not a JSON object");
  }
  const data = raw as Partial<RunSummary>;
  if (data.format !== undefined && data.format !== RESULTS_FORMAT) throw new NotAReportError(path);
  if (data.format === RESULTS_FORMAT) {
    const version = data.schemaVersion ?? 1;
    if (typeof version !== "number") throw new MalformedResultsError(path, "schemaVersion is not a number");
    if (version !== RESULTS_SCHEMA_VERSION) {
      throw new IncompatibleResultsError({
        dir: relative(process.cwd(), dirname(path)) || ".",
        schemaVersion: version,
        producerVersion: data.producer?.version,
      });
    }
  } else if (!("results" in data) && !("startedAt" in data)) {
    throw new NotAReportError(path);
  }
  if (!Array.isArray(data.results) || typeof data.startedAt !== "string") {
    throw new MalformedResultsError(path, "missing results[] or startedAt");
  }
  return data as RunSummary;
}

/** 把 loader 抛出的错误归类成 skipped 条目;无关 JSON 返回 undefined(不记)。 */
function classifySkip(e: unknown, path: string): SkippedRun | undefined {
  const relPath = relative(process.cwd(), path) || path;
  const dir = relative(process.cwd(), dirname(path)) || ".";
  if (e instanceof IncompatibleResultsError) {
    return {
      path: relPath,
      dir: e.run.dir,
      reason: "incompatible-version",
      schemaVersion: e.run.schemaVersion,
      producerVersion: e.run.producerVersion,
      command: incompatibleViewCommand(e.run),
    };
  }
  if (e instanceof MalformedResultsError) {
    return { path: relPath, dir, reason: "malformed", detail: e.detail };
  }
  if (e instanceof NotAReportError) return undefined;
  // 未预期的错误也按 malformed 记:比静默吞掉更容易暴露 loader 自身的 bug。
  return { path: relPath, dir, reason: "malformed", detail: e instanceof Error ? e.message : String(e) };
}

/**
 * 给每条 result 注入 view 侧标注:
 * - attemptRef:run 目录(相对 view 根)+ summary.results 下标,`#/attempt/<run>/<result>`
 *   深链的身份。必须在这里(读盘顺序)捕获下标——聚合层会把 results 重排。
 * - artifactBase:相对 view 根的工件目录(前端据此 fetch trace.json 等)。
 * 返回新对象,不 mutate 读入的 summary;宿主机绝对路径只写进 artifactDirs(server 端内存),
 * 不挂到 result 上,避免随 viewData 进静态 HTML。
 */
function withViewRefs(
  summary: RunSummary,
  summaryPath: string,
  root: string,
  artifactDirs: Map<string, string>,
): RunSummary {
  const runDir = dirname(summaryPath);
  // 单文件入口时 run 目录就是 view 根,relative 为空串;统一占位 "."(与 classifySkip 的目录口径一致)。
  const runRef = relative(root, runDir).split(/[\\/]/).join("/") || ".";
  return {
    ...summary,
    results: summary.results.map((r, index): ViewEvalResult => {
      const annotated: ViewEvalResult = { ...r, attemptRef: { run: runRef, result: index } };
      if (!r.artifactsDir) return annotated;
      const abs = join(runDir, r.artifactsDir);
      const base = relative(root, abs).split(/[\\/]/).join("/");
      artifactDirs.set(base, abs);
      return { ...annotated, artifactBase: base };
    }),
  };
}

async function findSummaryFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const direct = entries.filter((e) => e.isFile() && e.name === "summary.json").map((e) => join(dir, e.name));
  const nested = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => findSummaryFiles(join(dir, e.name))));
  return [...direct, ...nested.flat()];
}
