// cases: docs/engineering/unit-tests/experiments-runner/cases.md

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineEval, e2bSandbox, vercelSandbox } from "../define.ts";
import type { Agent, DiscoveredEval } from "../types.ts";
import type { AgentRun } from "./types.ts";
import { computeFingerprint } from "./fingerprint.ts";
import {
  prepareRunSandboxes,
  resolvedSandboxRecommendedConcurrency,
  sandboxForEval,
  sandboxProjection,
} from "./sandbox-selection.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function agent(kind: "sandbox" | "remote"): Agent {
  return { name: `${kind}-agent`, kind } as Agent;
}

async function evalDef(id: string, environment?: string): Promise<DiscoveredEval> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-sandbox-selection-"));
  roots.push(root);
  const sourcePath = join(root, "case.eval.ts");
  await writeFile(sourcePath, "export default { test() {} };\n");
  return {
    id,
    environment,
    baseDir: root,
    sourcePath,
    source: { path: "evals/case.eval.ts", content: "export default { test() {} };\n", sha256: "source" },
    test() {},
  };
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    agent: agent("sandbox"),
    flags: {},
    runs: 1,
    earlyExit: true,
    evalFilter: () => true,
    experimentId: "profiles/run",
    ...overrides,
  };
}

describe("eval-level sandbox selection", () => {
  it("每个 eval 只解析一次；投影、指纹与 provider 并发共用同一 resolved spec", async () => {
    const py39 = await evalDef("astropy/old", "python-3.9");
    const py311 = await evalDef("astropy/new", "python-3.11");
    let calls = 0;
    const selected = run({
      sandbox: ({ eval: item }) => {
        calls++;
        return item.environment === "python-3.9"
          ? e2bSandbox({ template: "astropy-py39" })
          : vercelSandbox({ snapshotId: "astropy-py311" });
      },
    });

    prepareRunSandboxes([py39, py311], [selected]);
    expect(calls).toBe(2);
    expect(sandboxForEval(selected, py39)?.provider).toBe("e2b");
    expect(sandboxForEval(selected, py311)?.provider).toBe("vercel");
    expect(resolvedSandboxRecommendedConcurrency([py39, py311], [selected])).toBe(1);
    const projection = sandboxProjection(selected);
    expect(projection.sandboxResolverFingerprint).toHaveLength(16);
    expect(projection.sandboxByEval).toMatchObject({
      "astropy/old": { provider: "e2b", params: { template: "astropy-py39" } },
      "astropy/new": { provider: "vercel", params: { snapshotId: "astropy-py311" } },
    });

    const [oldFingerprint, newFingerprint] = await Promise.all([
      computeFingerprint(py39, selected),
      computeFingerprint(py311, selected),
    ]);
    expect(oldFingerprint).not.toBe(newFingerprint);
    expect(calls).toBe(2);
  });

  it("resolver 返回空值时规划期报清晰错误；remote agent 完全不调用 resolver", async () => {
    expect(() => defineEval({ environment: "  ", test() {} })).toThrow(/environment.*non-empty profile id/);
    const item = await evalDef("astropy/invalid", "python-3.9");
    const invalid = run({ sandbox: (() => undefined) as unknown as AgentRun["sandbox"] });
    expect(() => prepareRunSandboxes([item], [invalid])).toThrow(
      /sandbox resolver.*profiles\/run.*astropy\/invalid.*python-3\.9.*concrete/,
    );

    let remoteCalls = 0;
    const remote = run({
      agent: agent("remote"),
      sandbox: () => {
        remoteCalls++;
        return e2bSandbox();
      },
    });
    expect(() => prepareRunSandboxes([item], [remote])).not.toThrow();
    expect(resolvedSandboxRecommendedConcurrency([item], [remote])).toBe(10);
    expect(sandboxProjection(remote)).toEqual({});
    expect(remoteCalls).toBe(0);
  });
});
