// 指纹缓存:用 (eval 源码 + 运行配置) 的稳定哈希标识一次 attempt 的输入。
// 上次 passed 且指纹未变的 (experimentId, evalId) 组合可以直接携入,不再重跑。

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sandboxRunInfo } from "../sandbox/resolve.ts";
import type { DiscoveredEval, EvalResult, JsonValue, SandboxOption } from "../types.ts";
import type { AgentRun } from "./types.ts";
import { prepareRunSandboxes, sandboxForEval } from "./sandbox-selection.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";

export function cacheKey(run: AgentRun, evalId: string): string {
  return `${run.experimentId ?? ""}|${evalId}`;
}

/**
 * 指纹口径里的 flags:去掉实验声明为出处记录的键(`ExperimentDef.provenanceFlags`)。
 * 这些键照常落盘、照常透传 `ctx.flags` / `t.flags`,只是不参与可比性——隧道 URL、跑批时刻
 * 这类连接坐标每次都变,把它们算进指纹会让每一次坐标轮换作废全部已完成结果。
 */
function fingerprintFlags(flags: Record<string, JsonValue>, provenanceFlags: readonly string[] | undefined): Record<string, JsonValue> {
  if (!provenanceFlags?.length) return flags;
  const drop = new Set(provenanceFlags);
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(flags)) if (!drop.has(k)) out[k] = v;
  return out;
}

/**
 * @param sourceCache 按 sourcePath 缓存文件内容:一个矩阵(实验 × eval)会对同一批源文件
 * 反复算指纹,不带缓存会在任何 attempt 起跑前做 E×N 次重复文件读。
 * @param flagsOverride 用这份 flags 代替 `run.flags` 的指纹口径算一遍。只有一个用途:
 * 对已落盘结果做**反事实重算**——「把 flags 换成它当时那份,指纹还相等吗」等价于问
 * 「除 flags 外的一切是否都没变」,`acceptableFingerprints` 用它判定某条历史结果与本次
 * 规划的差异是否完全落在 provenance flag 上。
 */
export async function computeFingerprint(
  evalDef: DiscoveredEval,
  run: AgentRun,
  sourceCache?: Map<string, Promise<string>>,
  configSandbox?: SandboxOption,
  flagsOverride?: Record<string, JsonValue>,
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
    },
    run: {
      experimentId: run.experimentId,
      agent: run.agent.name,
      model: run.model,
      flags: flagsOverride ?? fingerprintFlags(run.flags, run.provenanceFlags),
      sandbox: sandboxRunInfo(sandboxForEval(run, evalDef, configSandbox)),
      strict: run.strict,
    },
  };
  // timeoutMs(evalDef / run 两处来源)刻意不入哈希:超时上限不改变「结果是什么」,只决定
  // 「等不等得到」,把它掺进指纹会让单纯调高上限也作废全部已完成结果。它改用 planCarry 里的
  // 携带资格判据(durationMs ≤ 当前 resolved timeoutMs)参与,而不是指纹相等性
  // (见 docs/runner.md「缓存:指纹去重」)。
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export interface CarryPlan {
  /** `cacheKey(run, evalId)` → 本次规划出的指纹,供调用方按同一口径判断"这条要不要携入"。 */
  plannedFingerprints: Map<string, string>;
  /**
   * `cacheKey(run, evalId)` → 这条组合**可以携带的全部指纹**:本次规划的那个,加上
   * 「只在 provenance flag 上与本次不同」的历史口径(见 `acceptableFingerprints`)。
   * 没声明 provenance flag 时恒是单元素集合 = `plannedFingerprints` 的那一个。
   * 携带判定一律读这个集合,`plannedFingerprints` 只用来给新跑的 attempt 落盘打戳。
   */
  acceptableFingerprints: Map<string, Set<string>>;
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
 * 与 `attempt.ts` 里实际生效超时的解析顺序保持一致(`run.timeoutMs ?? evalDef.timeoutMs ??
 * configTimeoutMs`),但刻意不叠加 attempt.ts 的硬编码兜底(10 分钟):携带判据要问的是「用户
 * 有没有显式配置一条线」,三层都未设时线本身不存在,`Infinity` 让 durationMs 判据恒成立
 * (「当前未设上限 = 恒可携带」,见 docs/runner.md「缓存:指纹去重」)。10 分钟兜底是
 * attempt.ts 的执行期默认值,不是携带判据要遵守的线。
 */
export function resolvedTimeoutMsForCarry(run: AgentRun, evalDef: DiscoveredEval, configTimeoutMs?: number): number {
  return run.timeoutMs ?? evalDef.timeoutMs ?? configTimeoutMs ?? Infinity;
}

/**
 * 携带资格判据的**唯一**实现:从 `priorResults` 里挑出 `key` 这条 `(experimentId, evalId)`
 * 可以携入(跳过重跑)的 attempt。三条判据逐条 attempt 独立成立才算命中——
 *
 * 1. 该 attempt 自己是终态(`passed` / `failed`)。`errored` 是框架/环境层面的不确定失败,
 *    判定本身不可信;`skipped` 根本没跑。同一 eval 的别的序号命中不能连带把它捎上
 *    (反例与修法见 memory 的 carry-must-be-per-attempt-not-whole-eval-key)。
 * 2. 该 attempt 落盘的 `fingerprint` 落在本次的可携带指纹集合里(`CarryPlan.acceptableFingerprints`
 *    的那一条,通常只有本次规划出的那一个;声明了 provenance flag 时还含「只在这些键上与本次
 *    不同」的历史口径)。
 * 3. 该 attempt 的 `durationMs` 不超过本次 resolved 的 `timeoutMs`——`timeoutMs` 是携带资格
 *    判据、不进指纹哈希(docs/runner.md「缓存:指纹去重」)。
 *
 * `planCarry`(整场静态规划)与 run.ts 派发时刻的携带重查共用这一个函数:两条路径一旦把判据
 * 各写一份就会分叉,重查会携入静态规划判过不可携带的条目(或反过来)。
 */
export function carriableAttempts(
  priorResults: EvalResult[] | undefined,
  key: string,
  fingerprints: ReadonlySet<string> | undefined,
  timeoutMs: number,
): EvalResult[] {
  if (!priorResults?.length || fingerprints === undefined || fingerprints.size === 0) return [];
  const out: EvalResult[] = [];
  for (const r of priorResults) {
    if (!r.experimentId || `${r.experimentId}|${r.id}` !== key) continue;
    const isTerminalVerdict = r.verdict === "passed" || r.verdict === "failed";
    if (!isTerminalVerdict || r.fingerprint === undefined || !fingerprints.has(r.fingerprint)) continue;
    // `durationMs` 在 `EvalResult` 上是必填字段,正常落盘不会缺失;这里的 `typeof` 防御只处理
    // 磁盘数据损坏等异常情形——保守地判不可携带,而不是当 0 处理(当 0 会让所有旧记录都通过
    // 判据,把「数据缺失」悄悄伪装成「跑得很快」)。
    const durationMs = typeof r.durationMs === "number" && Number.isFinite(r.durationMs) ? r.durationMs : undefined;
    if (durationMs === undefined || durationMs > timeoutMs) continue;
    out.push(r);
  }
  return out;
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
 *
 * @param configTimeoutMs 项目级 `Config.timeoutMs`(携带资格判据的最后一层兜底,见
 * `resolvedTimeoutMsForCarry`)。省略时按未配置处理,不是当作 0——只有 `run.timeoutMs` /
 * `evalDef.timeoutMs` 都缺席时才轮到它兜底。
 */
export async function planCarry(
  evals: DiscoveredEval[],
  agentRuns: AgentRun[],
  priorResults: EvalResult[] | undefined,
  configSandbox?: SandboxOption,
  configTimeoutMs?: number,
  flagBagsByExperiment?: Map<string, Record<string, JsonValue>[]>,
): Promise<CarryPlan> {
  prepareRunSandboxes(evals, agentRuns, configSandbox);
  const sourceCache = new Map<string, Promise<string>>();
  const plannedFingerprints = new Map<string, string>();
  // 与 plannedFingerprints 同一批 (run × evalDef) 循环里顺带算好,供下面按 key 查「这个组合
  // 这次的携带资格线是多少」——同一个 key 在同一次 planCarry 调用里只对应一个 (run, evalDef)
  // 组合,与 plannedFingerprints 的 key 语义一致。
  const plannedTimeoutMs = new Map<string, number>();
  const acceptable = new Map<string, Set<string>>();
  const jobs: Promise<void>[] = [];
  for (const run of agentRuns) {
    for (const evalDef of selectedEvalsForRun(evals, run)) {
      const key = cacheKey(run, evalDef.id);
      plannedTimeoutMs.set(key, resolvedTimeoutMsForCarry(run, evalDef, configTimeoutMs));
      jobs.push(
        (async () => {
          const fp = await computeFingerprint(evalDef, run, sourceCache, configSandbox);
          plannedFingerprints.set(key, fp);
          acceptable.set(
            key,
            await acceptableFingerprints({
              evalDef,
              run,
              key,
              priorResults,
              primary: fp,
              sourceCache,
              configSandbox,
              ...(run.experimentId !== undefined && flagBagsByExperiment?.has(run.experimentId)
                ? { historicalFlagBags: flagBagsByExperiment.get(run.experimentId)! }
                : {}),
            }),
          );
        })(),
      );
    }
  }
  await Promise.all(jobs);

  // 判据本身在 carriableAttempts 里,这里只按 key 逐组调它——静态规划与派发时刻的重查因此
  // 不可能对「哪些携入」得出不同结论。
  const carriedAttemptsByKey = new Map<string, Set<number>>();
  const hit = new Set<EvalResult>();
  for (const key of plannedFingerprints.keys()) {
    const carried = carriableAttempts(priorResults, key, acceptable.get(key), plannedTimeoutMs.get(key) ?? Infinity);
    if (carried.length === 0) continue;
    const indices = new Set<number>();
    for (const r of carried) {
      indices.add(r.attempt);
      hit.add(r);
    }
    carriedAttemptsByKey.set(key, indices);
  }
  // 按 priorResults 的原始顺序输出(调用方的展示顺序不因分组而抖动)。
  const carriedResults = (priorResults ?? []).filter((r) => hit.has(r));
  return { plannedFingerprints, acceptableFingerprints: acceptable, carriedAttemptsByKey, carriedResults };
}

/**
 * 这条 `(experimentId, evalId)` 本次可以携带的指纹全集。
 *
 * 没声明 provenance flag 时就是 `{ primary }`——判据与「指纹相等」逐字等价,一条历史结果都
 * 不会因此多携入。声明了之后多出一类:**只在 provenance flag 上与本次不同**的历史口径。
 *
 * 判定不靠比对两串哈希的差异(哈希不可差分),而是**反事实重算**:取该历史结果所属快照记下的
 * `ExperimentRunInfo.flags`(整袋原样,`applySnapshotDefaults` 已把它挂在 `EvalResult.experiment`
 * 上),用它替换本次的 flags 口径重算一遍指纹——算出来等于历史那一串,就证明「除 flags 外的
 * 一切(eval 源码、agent、model、sandbox、strict…)都没变」。再要求两袋 flags 抹掉 provenance
 * 键之后逐字相等,才把这串历史指纹计入可携带集合:真改了某个影响行为的 flag(`webResearch`
 * 从 true 改成 false)照旧作废,不会被这条通道放行。
 *
 * 历史结果落盘时的指纹口径是「整袋 flags」(provenance 概念引入之前),所以两个口径都要试:
 * 整袋(老结果)与抹掉 provenance 键的那袋(声明之后跑出来的结果,与 primary 相同则自然去重)。
 */
export async function acceptableFingerprints(args: {
  evalDef: DiscoveredEval;
  run: AgentRun;
  key: string;
  priorResults: EvalResult[] | undefined;
  /** 本次规划出的指纹(新跑的 attempt 用它落盘打戳)。 */
  primary: string;
  /**
   * 该实验历史快照记下过的 flags(见 `loadCarryInputs`)。候选假设的来源之一,与结果自带的那袋
   * 并列——携带条目带着**产出它那一轮**的指纹合入新快照,那一轮的 flags 只在更早的快照里留着。
   */
  historicalFlagBags?: readonly Record<string, JsonValue>[];
  sourceCache?: Map<string, Promise<string>>;
  configSandbox?: SandboxOption;
}): Promise<Set<string>> {
  const { evalDef, run, key, priorResults, primary, historicalFlagBags, sourceCache, configSandbox } = args;
  const out = new Set([primary]);
  if (!run.provenanceFlags?.length) return out;
  const currentStripped = stableJson(fingerprintFlags(run.flags, run.provenanceFlags));
  const candidates: Record<string, JsonValue>[] = [];
  for (const r of priorResults ?? []) {
    if (!r.experimentId || `${r.experimentId}|${r.id}` !== key) continue;
    // 第三方落盘 / 缺 ExperimentRunInfo 时这里没有袋子可试,只能靠 historicalFlagBags。
    if (r.experiment?.flags !== undefined) candidates.push(r.experiment.flags);
  }
  candidates.push(...(historicalFlagBags ?? []));
  const seen = new Set<string>();
  for (const bag of candidates) {
    const bagJson = stableJson(bag);
    if (seen.has(bagJson)) continue;
    seen.add(bagJson);
    // 抹掉 provenance 键之后必须逐字相等:差异只准落在这些键上。
    if (stableJson(fingerprintFlags(bag, run.provenanceFlags)) !== currentStripped) continue;
    out.add(await computeFingerprint(evalDef, run, sourceCache, configSandbox, bag));
  }
  return out;
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
