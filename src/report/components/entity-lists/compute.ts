// 计算函数(*Data):ReportInput → 一份组件数据。实体列表族(ExperimentList / EvalList /
// AttemptList / FailureList)的 *Data 都住在这里(docs/feature/reports/library/entity-lists.md)。
//
// 共同约定(docs/feature/reports/architecture.md「指标聚合不变量」):
// - 第一参收 ReportInput = Scope | readonly Snapshot[];warnings 不进组件数据(宿主统一显示);
// - 聚合前按身份键去重(dedupeAttempts;missing-startedAt 不去重、如实保留、不透出警告);
// - null ≠ 0:缺数据不编数,覆盖率经 samples/total 如实暴露;
// - core 中立:只认 Metric / Dimension 接口,不出现具体 agent 名的分支。

import type {
  AttemptListItem,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  ReportInput,
} from "../../model/types.ts";
import type { EvalResult } from "../../../types.ts";
import type { Snapshot } from "../../../results/types.ts";
import { comparabilityConfigOf, deepEqualJson } from "../../../results/select.ts";
import { foldEvalVerdict } from "../../../shared/verdict.ts";
import {
  collectItems,
  computeCell,
  evalIdOf,
  experimentIdOf,
  fullEvalKey,
  groupItems,
  locatorOf,
  resolveInput,
  type Item,
} from "../../model/aggregate.ts";
import { attemptCostUSD, costUSD, durationMs, endToEndPassRate, examScore, tokens } from "../../model/metrics.ts";
import { compactAssertionSummary, primaryAssertionSummary, summaryText } from "../../../scoring/display.ts";
import { selectedEvalsOnly, summarizeItems } from "../shared-compute.ts";

/**
 * 一次 attempt 的单行结果摘要(Scoring display 契约):failed 取主失败断言摘要(不含
 * "+N more",N 单独进 moreFailures),errored 取结构化 error 的一层摘要
 * (phase · code · message),passed / skipped 为 null。
 */
export function failureSummaryOf(result: EvalResult): { summary: string | null; more: number } {
  if (result.verdict === "errored" && result.error !== undefined) {
    const parts = [result.error.phase, result.error.code, result.error.message].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return { summary: summaryText(parts.join(" · ")), more: 0 };
  }
  if (result.verdict === "failed" || result.verdict === "errored") {
    const primary = primaryAssertionSummary(result.assertions, result.verdict);
    if (primary !== undefined) {
      return {
        summary: compactAssertionSummary({ ...primary, additionalFailures: 0 }),
        more: primary.additionalFailures,
      };
    }
    if (result.verdict === "errored" && result.skipReason !== undefined) {
      return { summary: summaryText(result.skipReason), more: 0 };
    }
    return { summary: null, more: 0 };
  }
  return { summary: null, more: 0 };
}

/** AttemptList / ExperimentList / EvalList 共用的叶子构造:一个 Item → 一个 AttemptListItem。 */
async function attemptListItemOf(item: Item): Promise<AttemptListItem> {
  const result = item.attempt.result;
  const { summary, more } = failureSummaryOf(result);
  return {
    experimentId: experimentIdOf(item),
    evalId: evalIdOf(item),
    attempt: result.attempt,
    agent: result.agent,
    verdict: result.verdict,
    failureSummary: summary,
    moreFailures: more,
    examScore: await computeCell(examScore, [item]),
    durationMs: result.durationMs,
    costUSD: attemptCostUSD(result),
    locator: locatorOf(item),
  };
}

/** `attemptListData(input)`:每个 Attempt 一项,顺序取自 Scope 展平顺序(不重排)。 */
export async function attemptListData(input: ReportInput): Promise<AttemptListItem[]> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  return Promise.all(items.map((item) => attemptListItemOf(item)));
}

/** `evalListData(input)`:每个 `experimentId + evalId` 一项,按 evalId 再按 experimentId 升序。 */
export async function evalListData(input: ReportInput): Promise<EvalListItem[]> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = fullEvalKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const out: EvalListItem[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.attempt.result.attempt - b.attempt.result.attempt);
    const verdict = foldEvalVerdict(sorted.map((item) => item.attempt.result));
    const attempts = await Promise.all(sorted.map((item) => attemptListItemOf(item)));
    out.push({
      experimentId: experimentIdOf(sorted[0]!),
      evalId: evalIdOf(sorted[0]!),
      verdict,
      examScore: await computeCell(examScore, sorted),
      durationMs: await computeCell(durationMs, sorted),
      costUSD: await computeCell(costUSD, sorted),
      attempts,
    });
  }
  out.sort((a, b) => a.evalId.localeCompare(b.evalId) || a.experimentId.localeCompare(b.experimentId));
  return out;
}

/**
 * `experimentListData(input)`:每个 experiment 一项,展开到每道 Eval;初始按端到端通过率
 * 从高到低(缺数据沉底,同分按 id)。一行只有一套 agent / model / flags 是输入约束:
 * 宿主注入的 current() Scope 保证每个 experiment 只由可比性配置一致的快照拼成;作者自选
 * Snapshot[] 时若同一 experiment 混入不一致的可比性配置,按完整用户反馈失败并指引——
 * 看跨配置演化用 snapshot 维度或 MetricLine,不把两套配置拼成一行冒充单一配置。
 */
export async function experimentListData(input: ReportInput): Promise<ExperimentListItem[]> {
  const { snapshots: rawSnapshots } = resolveInput(input);
  const snapshots = selectedEvalsOnly(rawSnapshots);

  // 可比性配置单义检查:同一 experiment 的输入快照必须共享一套可比性配置。
  const configByExperiment = new Map<string, { snapshot: Snapshot; config: unknown }>();
  for (const snapshot of snapshots) {
    const config = comparabilityConfigOf(snapshot);
    const existing = configByExperiment.get(snapshot.experimentId);
    if (existing === undefined) {
      configByExperiment.set(snapshot.experimentId, { snapshot, config });
    } else if (!deepEqualJson(existing.config, config)) {
      throw new Error(
        `experimentListData got inconsistent comparability configs for experiment "${snapshot.experimentId}" ` +
          `(snapshots ${existing.snapshot.startedAt} and ${snapshot.startedAt} differ in agent/model/reasoningEffort/flags/budget/timeoutMs/sandbox). ` +
          "One row shows one configuration — it cannot honestly merge two. To chart evolution across configs, " +
          'use the "snapshot" dimension or MetricLine; to show the current level, pass results.current() which selects a single config per experiment.',
      );
    }
  }

  const items = collectItems(snapshots);
  const groups = groupItems(items, "experiment");
  const out: ExperimentListItem[] = [];
  for (const [experimentId, group] of groups) {
    const stats = summarizeItems(group);
    const newest = [...group].sort((a, b) => b.snapshot.startedAt.localeCompare(a.snapshot.startedAt))[0]!;
    const evalGroups = groupItems(group, "eval");
    const evalRows: ExperimentListEvalRow[] = [];
    for (const [evalId, evalItems] of evalGroups) {
      const sorted = [...evalItems].sort((a, b) => a.attempt.result.attempt - b.attempt.result.attempt);
      const verdict = foldEvalVerdict(sorted.map((item) => item.attempt.result));
      const attempts = await Promise.all(sorted.map((item) => attemptListItemOf(item)));
      evalRows.push({
        evalId,
        verdict,
        durationMs: await computeCell(durationMs, sorted),
        costUSD: await computeCell(costUSD, sorted),
        attempts,
      });
    }
    const experiment = newest.snapshot.experiment ?? newest.attempt.result.experiment;
    const model = newest.attempt.result.model ?? newest.snapshot.model;
    out.push({
      experimentId,
      agent: newest.snapshot.agent || newest.attempt.result.agent,
      ...(model !== undefined ? { model } : {}),
      ...(experiment?.flags ? { flags: experiment.flags } : {}),
      evalVerdicts: stats.verdicts,
      endToEndPassRate: await computeCell(endToEndPassRate, group),
      costUSD: await computeCell(costUSD, group),
      durationMs: await computeCell(durationMs, group),
      tokens: await computeCell(tokens, group),
      evals: stats.evals,
      attempts: stats.attempts,
      lastRunAt: stats.lastRunAt!,
      evalRows,
    });
  }
  // 初始态按端到端通过率(endToEndPassRate)从高到低,缺数据沉底;同分按 experiment id 稳定排序。
  out.sort((a, b) => {
    const va = a.endToEndPassRate.value;
    const vb = b.endToEndPassRate.value;
    if (va === null && vb === null) return a.experimentId.localeCompare(b.experimentId);
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || a.experimentId.localeCompare(b.experimentId);
  });
  return out;
}
