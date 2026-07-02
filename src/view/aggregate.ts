// 聚合层:把 loader 读到的 summary 揉成榜单行与页面 KPI。纯数据变换,不碰 fs / http。
// 折叠与格式化口径在 shared/ 与前端共用;这里只产原始值(number / ISO),格式化由前端按 locale 做。

import type { EvalResult, Usage } from "../types.ts";
import type { LoadedSummary, ScanResult } from "./loader.ts";
import { evalLevelStats } from "../shared/outcome.ts";
import { OUTCOME_ORDER, avg, displayExperimentName, fallbackExperimentLabel, sumMaybe } from "../shared/aggregate.ts";
import type { ViewData, ViewRow } from "./shared/types.ts";

/** 烘焙进 HTML 的页面数据;绝对路径等 server 私有信息在 loader 就没进 summary,这里只挑展示字段。 */
export function buildViewData(scan: ScanResult): ViewData {
  const latest = scan.loaded[0]?.summary;
  const totals = summarizeAll(scan.loaded);
  return {
    rows: aggregateRows(scan.loaded),
    name: latest?.name,
    lastRunAt: latest?.startedAt,
    passRate: totals.passRate,
    resultCount: totals.results,
    durationMs: totals.durationMs,
    estimatedCostUSD: totals.cost,
    skippedRuns: scan.skipped.map((run) => ({
      dir: run.dir,
      reason: run.reason,
      schemaVersion: run.schemaVersion,
      producerVersion: run.producerVersion,
      command: run.command,
      detail: run.detail,
    })),
  };
}

export function aggregateRows(loaded: LoadedSummary[]): ViewRow[] {
  const groups = new Map<string, EvalResult[]>();
  const lastRunAt = new Map<string, string>();
  for (const item of loaded) {
    for (const result of item.summary.results) {
      const key = result.experimentId ? `exp|||${result.experimentId}` : `legacy|||${result.agent}|||${result.model ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), result]);
      const prev = lastRunAt.get(key);
      if (!prev || item.summary.startedAt > prev) lastRunAt.set(key, item.summary.startedAt);
    }
  }

  return Array.from(groups.entries()).map(([key, results]) => {
    const first = results[0]!;
    const experimentId = first.experimentId;
    const cost = sumMaybe(results.map((r) => r.estimatedCostUSD));
    // 一行 = 一个实验,results 内按 eval id 折叠计票(passed/failed/通过率都是 eval 级)。
    const stats = evalLevelStats(results, (r) => r.id);
    return {
      key,
      experimentId,
      experiment: first.experiment,
      group: experimentGroup(experimentId),
      label: displayExperimentName(experimentId) ?? fallbackExperimentLabel(first),
      agent: first.agent,
      model: first.model,
      lastRunAt: lastRunAt.get(key),
      runs: results.length, // 总 attempt 数(详情里作次要信息)
      evals: stats.evals, // 去重后的 eval 数(成功率分母的口径)
      passed: stats.passed,
      failed: stats.failed,
      errored: stats.errored,
      skipped: stats.skipped,
      passRate: stats.passRate,
      avgDurationMs: avg(results.map((r) => r.durationMs)),
      usage: sumUsage(results.map((r) => r.usage)),
      estimatedCostUSD: cost,
      results: results
        .slice()
        .sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || a.id.localeCompare(b.id)),
    };
  });
}

function summarizeAll(loaded: LoadedSummary[]) {
  const results = loaded.flatMap((s) => s.summary.results);
  // 顶部总览同样按 eval 计票:每个(实验, eval)只算一份,跨实验/跨 run 不被 runs 灌票。
  const groupKey = (r: EvalResult) => (r.experimentId ? `exp|||${r.experimentId}` : `legacy|||${r.agent}|||${r.model ?? ""}`);
  const stats = evalLevelStats(results, (r) => `${groupKey(r)}|||${r.id}`);
  return {
    results: stats.evals,
    passRate: stats.passRate,
    durationMs: loaded.reduce((sum, s) => sum + (s.summary.durationMs ?? 0), 0),
    cost: sumMaybe(loaded.map((s) => s.summary.estimatedCostUSD)),
  };
}

function sumUsage(items: Array<Usage | undefined>): Usage {
  return {
    inputTokens: items.reduce((n, u) => n + (u?.inputTokens ?? 0), 0),
    outputTokens: items.reduce((n, u) => n + (u?.outputTokens ?? 0), 0),
    cacheReadTokens: items.reduce((n, u) => n + (u?.cacheReadTokens ?? 0), 0),
    cacheWriteTokens: items.reduce((n, u) => n + (u?.cacheWriteTokens ?? 0), 0),
    requests: items.reduce((n, u) => n + (u?.requests ?? 0), 0),
  };
}

function experimentGroup(id: string | undefined): string | undefined {
  if (!id || !id.includes("/")) return undefined;
  return id.split("/").slice(0, -1).join("/");
}
