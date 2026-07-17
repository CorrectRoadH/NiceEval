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
  ScopeWarning,
  SkippedDir,
  Snapshot,
} from "./types.ts";
import type { ExperimentRunInfo, JsonValue } from "../types.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";

/**
 * Results.latest() 的实现:每个实验取最新一次快照(= exp.snapshots[0]),生成挑选警告。
 * 收整个 `Results` 而不是裸 `Experiment[]`,是为了同时取 `skipped` / `root` 生成
 * `unreadable-snapshot` 警告(非实验作用域,不受 `opts.experiments` 过滤 —— 那些落盘
 * 本来就没能解析出 experimentId,没有前缀可过滤)。
 */
export function selectLatest(
  results: Pick<Results, "experiments" | "skipped" | "root">,
  opts?: { experiments?: string | string[] },
): Scope {
  const selected = filterExperiments(results.experiments, opts?.experiments);
  const snapshots = selected.map((exp) => exp.latest);
  const warnings: ScopeWarning[] = [];

  // stale 的基准:Scope 中最新的落盘(无阈值,如实触发;要阈值消费方按字段自比)。
  let latestStartedAt = "";
  for (const snapshot of snapshots) {
    if (snapshot.startedAt > latestStartedAt) latestStartedAt = snapshot.startedAt;
  }

  for (const exp of selected) {
    const snapshot = exp.latest;
    // 残缺检测:分母 = 该实验已知 eval 并集(本地历史 ∪ 各快照携带的 knownEvalIds)。
    // 位置参数允许只重跑一道题,产出的「最新快照」可能只有一道题 —— 不能安静吞下。
    const covered = snapshot.evals.length;
    const total = exp.evalIds.length;
    if (covered < total) {
      warnings.push({
        kind: "partial-coverage",
        experimentId: exp.id,
        covered,
        total,
        message: `snapshot covers ${covered} of ${total} evals seen in history; re-run \`niceeval exp ${exp.id}\` for a full snapshot`,
        command: `niceeval exp ${exp.id}`,
      });
    }
    if (snapshot.startedAt < latestStartedAt) {
      warnings.push({
        kind: "stale-snapshot",
        experimentId: exp.id,
        startedAt: snapshot.startedAt,
        latestStartedAt,
        message: `snapshot "${exp.id}" (${snapshot.startedAt}) predates the latest run in this scope by ${humanizeGap(snapshot.startedAt, latestStartedAt)}; re-run \`niceeval exp ${exp.id}\` to align, or ignore if evals, agent and model are unchanged between the runs`,
        command: `niceeval exp ${exp.id}`,
      });
    }
    if (!snapshot.completedAt) {
      warnings.push({
        kind: "unfinished-snapshot",
        experimentId: exp.id,
        startedAt: snapshot.startedAt,
        dir: snapshot.dir,
        message: `snapshot "${exp.id}" (${snapshot.startedAt}) has no completedAt — the run was interrupted; re-run \`niceeval exp ${exp.id}\` for a complete snapshot`,
        command: `niceeval exp ${exp.id}`,
      });
    }
  }
  warnings.push(...unreadableSnapshotWarnings(results.skipped, results.root));
  return makeScope("latest-snapshots", snapshots, warnings);
}

/** selectCurrentResults 的范围输入:experiment id 前缀与 eval id 前缀,都可缺省。 */
export interface ResultScope {
  /** experiment id 前缀(--experiment),分段匹配语义同 filterExperiments。 */
  experiment?: string | string[];
  /** eval id 前缀(位置参数),收窄 Scope 覆盖的 eval;覆盖警告分母同步收窄到范围内。 */
  patterns?: string[];
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
 * 两个宿主(show / view)共用的现刻水位选择器:每个 experiment × eval 取「包含该 eval 的
 * 最新快照」里的全部 attempt,跨 run 合成。results.latest() 只挑「每实验最新快照」,带 eval
 * 前缀的局部重跑会产出残缺快照;现刻水位承诺「不会因为一次局部重跑变残缺」,所以在实验的
 * 历史快照上逐 eval 向更早的 run 补齐,再把合成好的 Scope 交给宿主注入报告槽。
 *
 * **可比性前提**:每个 experiment 以最新快照的可比性配置(agent / model / reasoningEffort /
 * flags / budget / timeoutMs / sandbox)为基准,只有配置与基准深相等的历史快照才参与补齐;
 * 改过配置后只补跑部分 eval 时,旧配置快照覆盖的其余题不冒充新配置的水位,按 partial-coverage
 * 如实告警。这保证 current() 产出的每个 experiment 只对应一套配置。
 *
 * 同一 eval 的全部 attempts 必须整批取自包含它的最新快照,不把历史快照的 attempts 平铺后
 * 按 eval 聚合——否则会把不同运行的重试混成一次虚构运行。合成快照的 dir/元数据只服务报告
 * 分组与来源展示,证据身份一律来自 attempt 自己的 ref。
 */
export function selectCurrentResults(results: Results, scope: ResultScope = {}): Scope {
  const match =
    scope.patterns && scope.patterns.length > 0 ? evalPrefixPredicate(scope.patterns) : () => true;
  const experiments = filterExperiments(results.experiments, scope.experiment);

  const snapshots: Snapshot[] = [];
  const warnings: ScopeWarning[] = [];

  for (const exp of experiments) {
    // 可比性基准 = 该实验最新快照的可比性配置;不一致的旧快照整份跳过,不贡献 attempt。
    const baseline = comparabilityConfigOf(exp.latest);
    // 逐题取最新:快照按最新在前,首个出现即最新判定
    const taken = new Map<string, { ev: Eval; snapshot: Snapshot }>();
    for (const snapshot of exp.snapshots) {
      if (!deepEqualJson(comparabilityConfigOf(snapshot), baseline)) continue;
      for (const ev of snapshot.evals) {
        if (!match(ev.id) || taken.has(ev.id)) continue;
        taken.set(ev.id, { ev, snapshot });
      }
    }
    if (taken.size === 0) continue;

    const picks = [...taken.values()].sort((a, b) => a.ev.id.localeCompare(b.ev.id));
    let startedAt = "";
    let newest: Snapshot = picks[0].snapshot;
    for (const pick of picks) {
      if (pick.snapshot.startedAt > startedAt) {
        startedAt = pick.snapshot.startedAt;
        newest = pick.snapshot;
      }
    }
    const evals = picks.map((p) => p.ev);
    const base = exp.latest;
    snapshots.push({
      experimentId: exp.id,
      startedAt,
      agent: base.agent,
      ...(base.model !== undefined ? { model: base.model } : {}),
      ...(base.experiment !== undefined ? { experiment: base.experiment } : {}),
      ...(base.name !== undefined ? { name: base.name } : {}),
      producer: base.producer,
      schemaVersion: base.schemaVersion,
      evals,
      attempts: evals.flatMap((ev) => ev.attempts),
      dir: newest.dir,
      ...(newest.completedAt !== undefined ? { completedAt: newest.completedAt } : {}),
      ...(base.knownEvalIds ? { knownEvalIds: [...base.knownEvalIds] } : {}),
    });

    // 残缺检测:跨快照补齐后仍缺,来自「历史上见过却从未在可比配置的可读落盘里出现」的题
    // (含改配置后未补跑的题)—— 分母收窄到范围内,不让范围外的缺口刷屏。
    const total = exp.evalIds.filter(match).length;
    if (evals.length < total) {
      warnings.push({
        kind: "partial-coverage",
        experimentId: exp.id,
        covered: evals.length,
        total,
        message: `verdicts cover ${evals.length} of ${total} evals seen in history; re-run \`niceeval exp ${exp.id}\` for a full snapshot`,
        command: `niceeval exp ${exp.id}`,
      });
    }
  }

  let latestStartedAt = "";
  for (const snapshot of snapshots) {
    if (snapshot.startedAt > latestStartedAt) latestStartedAt = snapshot.startedAt;
  }
  for (const snapshot of snapshots) {
    if (snapshot.startedAt < latestStartedAt) {
      warnings.push({
        kind: "stale-snapshot",
        experimentId: snapshot.experimentId,
        startedAt: snapshot.startedAt,
        latestStartedAt,
        message: `verdicts for "${snapshot.experimentId}" were produced at ${snapshot.startedAt}, ${humanizeGap(snapshot.startedAt, latestStartedAt)} before the latest run in this scope; re-run \`niceeval exp ${snapshot.experimentId}\` to align, or ignore if evals, agent and model are unchanged between the runs`,
        command: `niceeval exp ${snapshot.experimentId}`,
      });
    }
    if (snapshot.completedAt === undefined) {
      warnings.push({
        kind: "unfinished-snapshot",
        experimentId: snapshot.experimentId,
        startedAt: snapshot.startedAt,
        dir: snapshot.dir,
        message: `snapshot "${snapshot.experimentId}" (${snapshot.startedAt}) is unfinished (the process was interrupted); completed attempts are read as-is, but the set may be incomplete — re-run \`niceeval exp ${snapshot.experimentId}\` for a complete snapshot`,
        command: `niceeval exp ${snapshot.experimentId}`,
      });
    }
  }

  warnings.push(...unreadableSnapshotWarnings(results.skipped, results.root));
  return makeScope("current-evals", snapshots, warnings);
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
 * attempts 随之同步修剪,warnings 修剪规则是「experimentId 不在幸存快照中的丢弃,
 * 非实验作用域的保留」(为将来非 per-experiment 的 kind 留位置)。
 */
export function makeScope(
  mode: Scope["mode"],
  snapshots: Snapshot[],
  warnings: ScopeWarning[],
): Scope {
  return {
    mode,
    snapshots,
    attempts: snapshots.flatMap((s) => s.attempts),
    warnings,
    filter(predicate: (snapshot: Snapshot) => boolean): Scope {
      const kept = snapshots.filter(predicate);
      const survivors = new Set(kept.map((s) => s.experimentId));
      const keptWarnings = warnings.filter((w) => {
        const scope = (w as { experimentId?: unknown }).experimentId;
        return typeof scope !== "string" || survivors.has(scope);
      });
      return makeScope(mode, kept, keptWarnings);
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

/** experiment id 分段前缀过滤(--experiment / latest({ experiments }) 同一语义);包内使用,不进公共 barrel。 */
export function filterExperiments(experiments: Experiment[], filter?: string | string[]): Experiment[] {
  if (filter === undefined) return experiments;
  // 允许 "compare/" 这种带尾斜杠的写法,与 "compare" 等价;分段匹配不误配 "compare2"。
  const prefixes = (Array.isArray(filter) ? filter : [filter]).map((p) => p.replace(/\/+$/, ""));
  return experiments.filter((exp) => prefixes.some((p) => exp.id === p || exp.id.startsWith(p + "/")));
}

/**
 * stale 警告的人话时距:选粒度最大的单位,四舍五入。结构化形态是单源——message 的英文时距
 * 与 ScopeWarnings 徽标的本地化时距都从这里出,阈值不写两份。
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

function humanizeGap(fromIso: string, toIso: string): string {
  const { n, unit } = gapParts(fromIso, toIso);
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
