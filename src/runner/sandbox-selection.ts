// ExperimentDef.sandbox 的规划期解析：固定 spec 原样复用；resolver 按 selected eval 恰好
// 调用一次并缓存。指纹、并发预算、attempt 创建与结果审计全部消费这同一份解析结果。

import { createHash } from "node:crypto";
import { sandboxRecommendedConcurrency, sandboxRunInfo } from "../sandbox/resolve.ts";
import type { DiscoveredEval, SandboxOption, SandboxRunInfo } from "../types.ts";
import type { AgentRun, ExperimentSandbox } from "./types.ts";

function selectedSandbox(run: AgentRun, fallback?: SandboxOption): ExperimentSandbox | undefined {
  return run.sandbox ?? fallback;
}

export function sandboxResolverFingerprint(resolver: (context: unknown) => SandboxOption): string {
  return createHash("sha256").update(resolver.toString()).digest("hex").slice(0, 16);
}

export function sandboxForEval(run: AgentRun, evalDef: DiscoveredEval, fallback?: SandboxOption): SandboxOption | undefined {
  if (run.agent.kind !== "sandbox") return undefined;
  const selection = selectedSandbox(run, fallback);
  if (typeof selection !== "function") return selection;

  const cached = run.resolvedSandboxes?.get(evalDef.id);
  if (cached !== undefined) return cached;

  const resolved = selection({
    eval: {
      id: evalDef.id,
      ...(evalDef.environment !== undefined ? { environment: evalDef.environment } : {}),
    },
  });
  if (typeof resolved !== "object" || resolved === null || typeof resolved.provider !== "string") {
    throw new Error(
      `sandbox resolver for experiment ${JSON.stringify(run.experimentId ?? run.agent.name)} returned no SandboxSpec for eval ${JSON.stringify(evalDef.id)}${evalDef.environment !== undefined ? ` (environment ${JSON.stringify(evalDef.environment)})` : ""}; return a concrete dockerSandbox(), e2bSandbox(), vercelSandbox(), or defineSandbox() spec from every branch`,
    );
  }
  const cache = run.resolvedSandboxes ?? new Map<string, SandboxOption>();
  cache.set(evalDef.id, resolved);
  run.resolvedSandboxes = cache;
  return resolved;
}

/** 在 dry-run / carry / concurrency / attempt 展开之前一次性解析，错误不会等到花费发生后才出现。 */
export function prepareRunSandboxes(evals: DiscoveredEval[], runs: AgentRun[], fallback?: SandboxOption): void {
  for (const run of runs) {
    if (run.agent.kind !== "sandbox") continue;
    const selection = selectedSandbox(run, fallback);
    if (typeof selection === "function") {
      run.sandboxResolverFingerprint = sandboxResolverFingerprint(selection as (context: unknown) => SandboxOption);
    }
    for (const evalDef of evals) {
      if (run.evalFilter(evalDef.id)) sandboxForEval(run, evalDef, fallback);
    }
  }
}

export function sandboxProjection(run: AgentRun, fallback?: SandboxOption): {
  sandbox?: SandboxRunInfo;
  sandboxResolverFingerprint?: string;
  sandboxByEval?: Record<string, SandboxRunInfo>;
} {
  if (run.agent.kind !== "sandbox") return {};
  const selection = selectedSandbox(run, fallback);
  if (typeof selection !== "function") {
    const sandbox = sandboxRunInfo(selection);
    return sandbox === undefined ? {} : { sandbox };
  }

  const sandboxByEval: Record<string, SandboxRunInfo> = {};
  for (const [evalId, spec] of [...(run.resolvedSandboxes ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const info = sandboxRunInfo(spec);
    if (info !== undefined) sandboxByEval[evalId] = info;
  }
  return {
    ...(run.sandboxResolverFingerprint !== undefined
      ? { sandboxResolverFingerprint: run.sandboxResolverFingerprint }
      : {}),
    sandboxByEval,
  };
}

export function resolvedSandboxRecommendedConcurrency(
  evals: DiscoveredEval[],
  runs: AgentRun[],
  fallback?: SandboxOption,
): number {
  prepareRunSandboxes(evals, runs, fallback);
  const recommendations: number[] = [];
  for (const run of runs) {
    if (run.agent.kind !== "sandbox") continue;
    for (const evalDef of evals) {
      if (!run.evalFilter(evalDef.id)) continue;
      recommendations.push(sandboxRecommendedConcurrency(sandboxForEval(run, evalDef, fallback)));
    }
  }
  return recommendations.length > 0 ? Math.min(...recommendations) : 10;
}
