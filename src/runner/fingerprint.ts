// 指纹缓存:用 (eval 源码 + 运行配置) 的稳定哈希标识一次 attempt 的输入。
// 上次 passed 且指纹未变的 (experimentId, evalId) 组合可以直接携入,不再重跑。

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sandboxRunInfo } from "../sandbox/resolve.ts";
import type { DiscoveredEval, EvalResult, SandboxOption } from "../types.ts";
import type { AgentRun } from "./types.ts";
import { prepareRunSandboxes, sandboxForEval } from "./sandbox-selection.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";

export function cacheKey(run: AgentRun, evalId: string): string {
  return `${run.experimentId ?? ""}|${evalId}`;
}

/**
 * @param sourceCache 按 sourcePath 缓存文件内容:一个矩阵(实验 × eval)会对同一批源文件
 * 反复算指纹,不带缓存会在任何 attempt 起跑前做 E×N 次重复文件读。
 */
export async function computeFingerprint(
  evalDef: DiscoveredEval,
  run: AgentRun,
  sourceCache?: Map<string, Promise<string>>,
  configSandbox?: SandboxOption,
): Promise<string> {
  let sourcePromise = sourceCache?.get(evalDef.sourcePath);
  if (!sourcePromise) {
    sourcePromise = readFile(evalDef.sourcePath, "utf-8");
    sourceCache?.set(evalDef.sourcePath, sourcePromise);
  }
  const source = await sourcePromise;
  const payload = {
    source,
    eval: {
      id: evalDef.id,
      tags: evalDef.tags ?? [],
      environment: evalDef.environment,
      metadata: evalDef.metadata ?? {},
      timeoutMs: evalDef.timeoutMs,
    },
    run: {
      experimentId: run.experimentId,
      agent: run.agent.name,
      model: run.model,
      flags: run.flags,
      sandbox: sandboxRunInfo(sandboxForEval(run, evalDef, configSandbox)),
      timeoutMs: run.timeoutMs,
      strict: run.strict,
    },
  };
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export interface CarryPlan {
  /** `cacheKey(run, evalId)` → 本次规划出的指纹,供调用方按同一口径判断"这条要不要携入"。 */
  plannedFingerprints: Map<string, string>;
  /**
   * 携带以 attempt 为粒度:命中携入条件(该 attempt 自身 passed/failed 终态 + 指纹匹配)的
   * `${experimentId}|${evalId}` → 该 eval 下具体携入的 attempt 序号集合(0-based)。同一个
   * eval 在 `runs > 1` 时可能只有部分序号是终态、其余是 errored/未跑完——只有逐条命中的那些
   * 序号才在这个集合里,不是"key 命中就整段携入"(反例与修法见 memory 的
   * carry-includes-failed-verdict)。
   */
  carriedAttemptsByKey: Map<string, Set<number>>;
  /** carriedAttemptsByKey 对应的完整结果对象,供 run.ts 直接并入 summary、cli.ts 直接取 verdict 展示。 */
  carriedResults: EvalResult[];
}

/**
 * 算出这一批 (agentRun × eval) 的指纹,并据此从 priorResults 里筛出可以携入(跳过重跑)的结果。
 * run.ts 与 cli.ts(live 表格构建)必须共用这同一份计算 —— 否则两边一旦对"哪些携入"的判断
 * 不一致,live 表格就会显示"还在等名额",而 run.ts 其实已经把它筛掉、根本不会调度这个 attempt
 * (见 memory 的 live-carry-row-shows-waiting-forever)。
 *
 * 携带来源不要求快照收尾:`priorResults` 来自 `loadLatestResultsPerEval`,它按落盘的
 * `result.json` 一条条读,不检查所属快照有没有 `completedAt`——被中断或强杀的 run 留下的
 * 未收尾快照,其中已落盘的终态 attempt 同样进入这里的候选集合(见 docs/runner.md
 * 「缓存:指纹去重」)。
 */
export async function planCarry(
  evals: DiscoveredEval[],
  agentRuns: AgentRun[],
  priorResults: EvalResult[] | undefined,
  configSandbox?: SandboxOption,
): Promise<CarryPlan> {
  prepareRunSandboxes(evals, agentRuns, configSandbox);
  const sourceCache = new Map<string, Promise<string>>();
  const plannedFingerprints = new Map<string, string>();
  const jobs: Promise<void>[] = [];
  for (const run of agentRuns) {
    for (const evalDef of selectedEvalsForRun(evals, run)) {
      jobs.push(
        computeFingerprint(evalDef, run, sourceCache, configSandbox).then((fp) => {
          plannedFingerprints.set(cacheKey(run, evalDef.id), fp);
        }),
      );
    }
  }
  await Promise.all(jobs);

  const carriedAttemptsByKey = new Map<string, Set<number>>();
  const carriedResults: EvalResult[] = [];
  if (priorResults?.length) {
    for (const r of priorResults) {
      if (!r.experimentId) continue;
      const key = `${r.experimentId}|${r.id}`;
      // 逐条判断:这一条 attempt 自己是终态、且自己的指纹与本次规划一致才携入——errored /
      // skipped 永不携带,即使同一 eval 的另一个 attempt 序号命中终态也不能连带把它捎上。
      const isTerminalVerdict = r.verdict === "passed" || r.verdict === "failed";
      if (!isTerminalVerdict || r.fingerprint === undefined || r.fingerprint !== plannedFingerprints.get(key)) continue;
      let indices = carriedAttemptsByKey.get(key);
      if (!indices) carriedAttemptsByKey.set(key, (indices = new Set()));
      indices.add(r.attempt);
      carriedResults.push(r);
    }
  }
  return { plannedFingerprints, carriedAttemptsByKey, carriedResults };
}

/** 键序稳定的 JSON 序列化(对象键排序),保证同一 payload 永远同一指纹。 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(",")}}`;
}
