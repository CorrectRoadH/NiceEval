// 快照 Scope 与 attempt 去重(定稿见 docs/feature/results/library.md「选择快照」「官方现刻水位」「身份键与去重」)。
//
// 选择器长在集合上(results.latest() / results.current()),不是 DSL,只是最常用的两种口径。
// 选择器必须诚实:残缺、落后、未收尾都被算出来,以结构化 warnings 随 Scope 走 ——
// 渲染与否在消费方(message 是渲染好的英文句子,以下一步收尾),但缺口不静默。

import type {
  AttemptHandle,
  DedupeWarning,
  Eval,
  Experiment,
  Results,
  Scope,
  ScopeCoverage,
  ScopeWarning,
  SkippedDir,
  Snapshot,
} from "./types.ts";
import type { ExperimentRunInfo, JsonValue } from "../types.ts";
import { evalPrefixPredicate, matchExperimentSelector } from "../shared/aggregate.ts";

/**
 * Results.latest() 的实现:每个实验取最新一次快照(= exp.snapshots[0]),生成覆盖事实与
 * 挑选警告。收整个 `Results` 而不是裸 `Experiment[]`,是为了同时取 `skipped` / `root` 生成
 * `unreadable-snapshot` 警告(非实验作用域,不受 `opts.experiments` 过滤 —— 那些落盘
 * 本来就没能解析出 experimentId,没有前缀可过滤)。
 */
export function selectLatest(
  results: Pick<Results, "experiments" | "skipped" | "root">,
  opts?: { experiments?: string | string[]; fresh?: boolean },
): Scope {
  const selected = filterExperiments(results.experiments, opts?.experiments);
  const fresh = opts?.fresh === true;
  const warnings: ScopeWarning[] = [];
  const coverage: ScopeCoverage[] = [];
  const snapshots: Snapshot[] = [];

  for (const exp of selected) {
    const raw = exp.latest;
    // fresh: true 只保留新执行的 attempt——在 latest() 口径下,选中集合永远只有这一份
    // 快照,「所属快照早于该实验在 Scope 中最新快照」这条历史出身天生不成立(只有它自己),
    // 唯一的历史出身是携带条目(attempt.carried)。
    const snapshot = fresh ? withFreshEvals(raw, raw.startedAt) : raw;
    snapshots.push(snapshot);

    // 覆盖事实:分母 = 该实验已知 eval 并集(本地历史 ∪ 各快照携带的 knownEvalIds),
    // 分子 = 当前口径(可能已被 fresh 收窄)下有 attempt 的题。位置参数允许只重跑一道题、
    // fresh 允许全部结果都是携带 —— 两种情况都不能安静吞下,统一进 missingEvalIds。
    const knownEvalIds = exp.evalIds;
    const coveredIds = new Set(snapshot.evals.map((ev) => ev.id));
    coverage.push({
      experimentId: exp.id,
      knownEvalIds: [...knownEvalIds],
      missingEvalIds: knownEvalIds.filter((id) => !coveredIds.has(id)),
    });

    if (!raw.completedAt) {
      warnings.push({
        kind: "unfinished-snapshot",
        experimentId: exp.id,
        startedAt: raw.startedAt,
        dir: raw.dir,
        message: `snapshot "${exp.id}" (${raw.startedAt}) has no completedAt — the run was interrupted; re-run \`niceeval exp ${exp.id}\` for a complete snapshot`,
        command: `niceeval exp ${exp.id}`,
      });
    }
  }
  warnings.push(...unreadableSnapshotWarnings(results.skipped, results.root));
  return makeScope("latest-snapshots", snapshots, warnings, coverage);
}

/** selectCurrentResults 的范围输入:experiment id 前缀与 eval id 前缀,都可缺省。 */
export interface ResultScope {
  /** experiment id 前缀(--exp),分段匹配语义同 filterExperiments。 */
  experiment?: string | string[];
  /** eval id 前缀(位置参数),收窄 Scope 覆盖的 eval;覆盖事实分母同步收窄到范围内。 */
  patterns?: string[];
  /** 只保留新执行的 attempt(排除携带条目与跨快照拼入的历史执行);被排除的题进 coverage.missingEvalIds。 */
  fresh?: boolean;
}

// ───────────────────────── 可比性配置 ─────────────────────────

/**
 * current() 跨快照拼接的可比性前提所比较的字段集(docs/feature/results/library.md
 * 「官方现刻水位」):会改变单题被测行为或判定的字段。runs / earlyExit / maxConcurrency /
 * selectedEvalIds / evalFilterFingerprint / description 是编排与选题字段,不参与比较。
 */
export interface ComparabilityConfig {
  agent: string;
  model?: string;
  reasoningEffort?: string;
  flags?: Record<string, JsonValue>;
  budget?: number;
  timeoutMs?: number;
  sandbox?: ExperimentRunInfo["sandbox"];
}

/** 一个快照的可比性配置投影;pairsByFlag 与 experimentListData 复用同一字段集。 */
export function comparabilityConfigOf(snapshot: Snapshot): ComparabilityConfig {
  const info = snapshot.experiment;
  return {
    agent: snapshot.agent,
    ...(snapshot.model !== undefined ? { model: snapshot.model } : {}),
    ...(info?.reasoningEffort !== undefined ? { reasoningEffort: info.reasoningEffort } : {}),
    ...(info?.flags !== undefined ? { flags: info.flags } : {}),
    ...(info?.budget !== undefined ? { budget: info.budget } : {}),
    ...(info?.timeoutMs !== undefined ? { timeoutMs: info.timeoutMs } : {}),
    ...(info?.sandbox !== undefined ? { sandbox: info.sandbox } : {}),
  };
}

/** 可序列化值的深相等(对象键序无关;undefined 字段与缺席字段等价)。 */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualJson(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const keysA = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const keysB = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) =>
      deepEqualJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * 一个快照实际选中的 eval id 全集:优先读落盘的 `experiment.selectedEvalIds`(niceeval 自己的
 * 写入面必有此字段);第三方 harness 未实现该字段时退化为该快照实际写出的 `evals`,不把整份
 * 来源排除在外(见 docs/feature/results/architecture.md「selectedEvalIds」)。
 */
export function selectedEvalIdsOf(snapshot: Snapshot): readonly string[] {
  return snapshot.experiment?.selectedEvalIds ?? snapshot.evals.map((ev) => ev.id);
}

/**
 * 两个宿主(show / view)共用的现刻水位选择器:每个 experiment × eval 取「包含该 eval 的
 * 最新快照」里的全部 attempt,跨 run 合成。results.latest() 只挑「每实验最新快照」,带 eval
 * 前缀的局部重跑会产出残缺快照;现刻水位承诺「不会因为一次局部重跑变残缺」,所以在实验的
 * 历史快照上逐 eval 向更早的 run 补齐,再把合成好的 Scope 交给宿主注入报告槽。
 *
 * **可比性前提**:每个 experiment 以最新快照的可比性配置(agent / model / reasoningEffort /
 * flags / budget / timeoutMs / sandbox)为基准,只有配置与基准深相等的历史快照才参与补齐;
 * 改过配置后只补跑部分 eval 时,旧配置快照覆盖的其余题不冒充新配置的水位,进
 * `coverage.missingEvalIds` 如实呈现。这保证 current() 产出的每个 experiment 只对应一套配置。
 *
 * 同一 eval 的全部 attempts 必须整批取自包含它的最新快照,不把历史快照的 attempts 平铺后
 * 按 eval 聚合——否则会把不同运行的重试混成一次虚构运行。合成快照的 dir/元数据只服务报告
 * 分组与来源展示,证据身份一律来自 attempt 自己的 ref。
 */
export function selectCurrentResults(results: Results, scope: ResultScope = {}): Scope {
  const match =
    scope.patterns && scope.patterns.length > 0 ? evalPrefixPredicate(scope.patterns) : () => true;
  const experiments = filterExperiments(results.experiments, scope.experiment);
  const fresh = scope.fresh === true;

  const snapshots: Snapshot[] = [];
  const warnings: ScopeWarning[] = [];
  const coverage: ScopeCoverage[] = [];

  for (const exp of experiments) {
    // 可比性基准 = 该实验最新快照的可比性配置;不一致的旧快照整份跳过,不贡献 attempt。
    const baseline = comparabilityConfigOf(exp.latest);
    // 逐题取最新:快照按最新在前,首个出现即最新判定
    const taken = new Map<string, { ev: Eval; snapshot: Snapshot }>();
    for (const snapshot of exp.snapshots) {
      if (!deepEqualJson(comparabilityConfigOf(snapshot), baseline)) continue;
      // 一个来源快照只贡献它自己选中的 eval——不在其 selectedEvalIds(或第三方退化后的实际
      // evals)内的历史 attempt 不进入合成结果,即使它恰好出现在 snapshot.evals 里。第三方
      // 无该字段时 selectedEvalIdsOf 退化为快照实际 evals,这里的过滤天然是 no-op。
      const selectedIds = new Set(selectedEvalIdsOf(snapshot));
      for (const ev of snapshot.evals) {
        if (!selectedIds.has(ev.id) || !match(ev.id) || taken.has(ev.id)) continue;
        taken.set(ev.id, { ev, snapshot });
      }
    }
    if (taken.size === 0) {
      // 即使没有任何可比配置的历史贡献,该实验已知(范围内)的题仍然是覆盖缺口。
      const knownEvalIds = exp.evalIds.filter(match);
      if (knownEvalIds.length > 0) {
        coverage.push({ experimentId: exp.id, knownEvalIds, missingEvalIds: [...knownEvalIds] });
      }
      continue;
    }

    const picks = [...taken.values()].sort((a, b) => a.ev.id.localeCompare(b.ev.id));
    let startedAt = "";
    let newest: Snapshot = picks[0].snapshot;
    for (const pick of picks) {
      if (pick.snapshot.startedAt > startedAt) {
        startedAt = pick.snapshot.startedAt;
        newest = pick.snapshot;
      }
    }
    // fresh: true 只保留该实验「新执行」的 attempt——属于最新贡献快照(startedAt 就是它的
    // startedAt)且非携带的 attempt;历史执行整条排除,题内全部历史执行时整道题被排除。
    // startedAt/newest 的计算不受 fresh 影响(取自全部 picks,不是过滤后的子集)。
    const evals = fresh ? freshEvals(picks.map((p) => p.ev), startedAt) : picks.map((p) => p.ev);
    const base = exp.latest;
    // 合成快照的 selectedEvalIds 重建为最终 picks 的有序 id 列表——不是照抄某一来源快照
    // (通常是最新快照)的局部选择。base.experiment 缺失(第三方无 ExperimentRunInfo)时不
    // 伪造一份不完整投影,继续靠 report 侧 fallback(见 selectedEvalIdsOf)。
    const experiment =
      base.experiment !== undefined ? { ...base.experiment, selectedEvalIds: evals.map((ev) => ev.id) } : undefined;
    snapshots.push({
      experimentId: exp.id,
      startedAt,
      agent: base.agent,
      ...(base.model !== undefined ? { model: base.model } : {}),
      ...(experiment !== undefined ? { experiment } : {}),
      ...(base.name !== undefined ? { name: base.name } : {}),
      producer: base.producer,
      schemaVersion: base.schemaVersion,
      evals,
      attempts: evals.flatMap((ev) => ev.attempts),
      dir: newest.dir,
      ...(newest.completedAt !== undefined ? { completedAt: newest.completedAt } : {}),
      ...(base.knownEvalIds ? { knownEvalIds: [...base.knownEvalIds] } : {}),
    });

    // 覆盖事实:分母收窄到范围内(--exp / 位置参数),不让范围外的缺口刷屏;跨快照补齐后
    // 仍缺的题——「历史上见过却从未在可比配置的可读落盘里出现」(含改配置后未补跑的题)、
    // 或被 fresh 排除的题——统一进 missingEvalIds,不静默。
    const knownEvalIds = exp.evalIds.filter(match);
    const coveredIds = new Set(evals.map((ev) => ev.id));
    coverage.push({
      experimentId: exp.id,
      knownEvalIds,
      missingEvalIds: knownEvalIds.filter((id) => !coveredIds.has(id)),
    });

    if (newest.completedAt === undefined) {
      warnings.push({
        kind: "unfinished-snapshot",
        experimentId: exp.id,
        startedAt,
        dir: newest.dir,
        message: `snapshot "${exp.id}" (${startedAt}) is unfinished (the process was interrupted); completed attempts are read as-is, but the set may be incomplete — re-run \`niceeval exp ${exp.id}\` for a complete snapshot`,
        command: `niceeval exp ${exp.id}`,
      });
    }
  }

  warnings.push(...unreadableSnapshotWarnings(results.skipped, results.root));
  return makeScope("current-evals", snapshots, warnings, coverage);
}

/**
 * 保留一组 Eval 里的新执行 attempt:非携带、且所属快照的 startedAt = 该实验在 Scope 中最新
 * 快照的 startedAt(latest() 口径下恒真,只剩 carried 过滤;current() 口径下额外排除跨快照
 * 拼入的历史执行)。题内全部 attempt 被排除时整道题丢弃——覆盖事实随后据此把它计入
 * missingEvalIds,不伪造一道没有新执行的空题。
 */
function freshEvals(evals: readonly Eval[], scopeStartedAt: string): Eval[] {
  const out: Eval[] = [];
  for (const ev of evals) {
    const attempts = ev.attempts.filter((a) => !a.carried && a.snapshot.startedAt >= scopeStartedAt);
    if (attempts.length > 0) out.push({ id: ev.id, attempts });
  }
  return out;
}

/** `withFreshEvals`:selectLatest() 用——对单个快照应用 `freshEvals`,产出新的 Snapshot 对象。 */
function withFreshEvals(snapshot: Snapshot, scopeStartedAt: string): Snapshot {
  const evals = freshEvals(snapshot.evals, scopeStartedAt);
  return { ...snapshot, evals, attempts: evals.flatMap((ev) => ev.attempts) };
}

/**
 * `results.skipped` 里每一条不可读落盘 → 一条 `unreadable-snapshot` ScopeWarning。
 * 非实验作用域(没有 experimentId 字段):`latest()` / `current()` 都原样带上全部
 * `skipped` 条目,不受 `opts.experiments` 前缀过滤影响(那些落盘本来就没能解析出
 * experimentId,没有前缀可比);`makeScope().filter()` 按「非实验作用域的警告保留」
 * 规则自动放行,不需要额外分支。
 */
function unreadableSnapshotWarnings(skipped: readonly SkippedDir[], root: string): ScopeWarning[] {
  return skipped.map((s): ScopeWarning => {
    switch (s.reason) {
      case "incompatible-version": {
        const producer = s.producer;
        const schemaText = s.schemaVersion !== undefined ? ` (schemaVersion ${s.schemaVersion})` : "";
        if (producer?.name === "niceeval" && producer.version) {
          const command = `npx niceeval@${producer.version} show --results ${root}`;
          return {
            kind: "unreadable-snapshot",
            dir: s.dir,
            reason: s.reason,
            message: `snapshot at "${s.dir}" was written by niceeval ${producer.version}${schemaText} and cannot be read by this version; run \`${command}\` to open it`,
            command,
          };
        }
        const writtenBy = producer?.name
          ? `${producer.name}${producer.version ? ` ${producer.version}` : ""}`
          : "an incompatible tool version";
        return {
          kind: "unreadable-snapshot",
          dir: s.dir,
          reason: s.reason,
          message: `snapshot at "${s.dir}" was written by ${writtenBy}${schemaText} and cannot be read by this version; open it with the tool version that produced it`,
        };
      }
      case "malformed": {
        const detail = s.detail ? ` (${s.detail})` : "";
        return {
          kind: "unreadable-snapshot",
          dir: s.dir,
          reason: s.reason,
          message: `snapshot at "${s.dir}" is malformed${detail} and was skipped; inspect snapshot.json in that directory for corrupted JSON or a missing required field`,
        };
      }
      case "incomplete":
        return {
          kind: "unreadable-snapshot",
          dir: s.dir,
          reason: s.reason,
          message: `snapshot at "${s.dir}" has attempt data but no snapshot.json (likely interrupted before metadata was written) and was skipped; inspect ${s.dir} — completed attempts remain on disk for manual review`,
        };
    }
  });
}

/**
 * Scope 构造:attempts 按口径物化(快照 attempts 的平铺);filter 只删不换 —— 快照删减,
 * attempts、coverage 与 warnings 随之同步修剪,修剪规则是「experimentId 不在幸存快照中的
 * 条目丢弃,非实验作用域的警告保留」(为将来非 per-experiment 的 kind 留位置)。`coverage`
 * 缺省为 `[]`(测试里手工构造 Scope、不关心覆盖事实时不用逐处补参数)。
 */
export function makeScope(
  mode: Scope["mode"],
  snapshots: Snapshot[],
  warnings: ScopeWarning[],
  coverage: ScopeCoverage[] = [],
): Scope {
  return {
    mode,
    snapshots,
    attempts: snapshots.flatMap((s) => s.attempts),
    coverage,
    warnings,
    filter(predicate: (snapshot: Snapshot) => boolean): Scope {
      const kept = snapshots.filter(predicate);
      const survivors = new Set(kept.map((s) => s.experimentId));
      const keptWarnings = warnings.filter((w) => {
        const scope = (w as { experimentId?: unknown }).experimentId;
        return typeof scope !== "string" || survivors.has(scope);
      });
      const keptCoverage = coverage.filter((c) => survivors.has(c.experimentId));
      return makeScope(mode, kept, keptWarnings, keptCoverage);
    },
  };
}

/**
 * 跨快照聚合前的身份键去重:(experimentId, evalId, attempt, startedAt)。
 * 携带合入会把上一轮已通过的结果原样合入新快照,同一 attempt 因此存在于多份落盘;
 * 重复时保留最新快照里的那份(内容相同,取新快照的副本让 ref 落在最新落盘上;
 * 位置取首次出现处,顺序稳定)。startedAt 缺失时宁可不去重也不误删,记入 warnings。
 */
export function dedupeAttempts(attempts: AttemptHandle[]): { attempts: AttemptHandle[]; warnings: DedupeWarning[] } {
  const deduped: AttemptHandle[] = [];
  const indexByKey = new Map<string, number>();
  const warnings: DedupeWarning[] = [];

  for (const attempt of attempts) {
    const r = attempt.result;
    if (!r.startedAt) {
      warnings.push({
        kind: "missing-startedAt",
        experimentId: attempt.experimentId,
        evalId: attempt.evalId,
        message: `attempt ${r.attempt} of eval "${attempt.evalId}" in experiment "${attempt.experimentId}" has no startedAt; kept as-is without dedupe`,
      });
      deduped.push(attempt);
      continue;
    }
    const key = JSON.stringify([attempt.experimentId, r.id, r.attempt, r.startedAt]);
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(attempt);
    } else if (isNewerSnapshot(attempt.snapshot, deduped[existing].snapshot)) {
      deduped[existing] = attempt;
    }
  }
  return { attempts: deduped, warnings };
}

/** 快照新旧比较:startedAt 优先,同刻按快照目录名(时间戳 + 随机后缀,字典序即时序)。 */
export function isNewerSnapshot(a: Snapshot, b: Snapshot): boolean {
  const byStart = a.startedAt.localeCompare(b.startedAt);
  if (byStart !== 0) return byStart > 0;
  return a.dir.localeCompare(b.dir) > 0;
}

/**
 * experiment 选择器过滤(--exp / latest({ experiments }) 同一语义,与 `niceeval exp` 位置参数
 * 共用 matchExperimentSelector,见 docs/feature/experiments/cli.md「实验选择器怎样解析」);
 * 包内使用,不进公共 barrel。
 */
export function filterExperiments(experiments: Experiment[], filter?: string | string[]): Experiment[] {
  if (filter === undefined) return experiments;
  // 允许 "compare/" 这种带尾斜杠的写法,与 "compare" 等价;分段匹配不误配 "compare2"。
  const prefixes = (Array.isArray(filter) ? filter : [filter]).map((p) => p.replace(/\/+$/, ""));
  const ids = experiments.map((exp) => exp.id);
  const matched = new Set(prefixes.flatMap((p) => matchExperimentSelector(ids, p)));
  return experiments.filter((exp) => matched.has(exp.id));
}

/**
 * 时效标注(`↩` + 人话时距)的粒度选择:选粒度最大的单位,四舍五入。结构化形态是单源——
 * entity-lists 渲染面的紧凑时距("3d")与曾经的 stale-snapshot message 用同一套阈值,
 * 阈值不写两份(docs/feature/reports/library/entity-lists.md「时效标注」)。
 */
export function gapParts(fromIso: string, toIso: string): { n: number; unit: "second" | "minute" | "hour" | "day" } {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return { n: seconds, unit: "second" };
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return { n: minutes, unit: "minute" };
  const hours = Math.round(minutes / 60);
  if (hours < 36) return { n: hours, unit: "hour" };
  return { n: Math.round(hours / 24), unit: "day" };
}
