// loadLatestResultsPerEval:续跑携带基线必须是跨历史「每 (experimentId, evalId) 最新一份」,
// 而不是最近一个 run —— 否则部分补跑 run 会把基线清空,`exp <组>` 补齐失效。
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLatestResultsPerEval } from "./loader.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../runner/types.ts";

let root: string;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function writeRun(dir: string, startedAt: string, results: object[]): Promise<void> {
  await mkdir(join(root, dir), { recursive: true });
  await writeFile(
    join(root, dir, "summary.json"),
    JSON.stringify({ format: RESULTS_FORMAT, schemaVersion: RESULTS_SCHEMA_VERSION, startedAt, results }),
  );
}

function result(experimentId: string, id: string, outcome: string, extra: object = {}): object {
  return { experimentId, id, agent: "a", outcome, ...extra };
}

describe("loadLatestResultsPerEval", () => {
  it("部分补跑 run 只遮蔽它跑过的 eval,其它 eval 仍取自更早的全量 run", async () => {
    root = await mkdtemp(join(tmpdir(), "niceeval-loader-"));
    await writeRun("2026-01-01T00-00-00", "2026-01-01T00:00:00.000Z", [
      result("exp/a", "e1", "passed"),
      result("exp/a", "e2", "errored"),
      result("exp/b", "e1", "passed"),
    ]);
    // 部分补跑:只重跑了 exp/a 的 e2
    await writeRun("2026-01-02T00-00-00", "2026-01-02T00:00:00.000Z", [result("exp/a", "e2", "passed")]);

    const results = (await loadLatestResultsPerEval(root)) as Array<{ experimentId: string; id: string; outcome: string }>;
    const byKey = new Map(results.map((r) => [`${r.experimentId}|${r.id}`, r.outcome]));
    expect(byKey.get("exp/a|e1")).toBe("passed"); // 来自旧全量 run,没被部分 run 冲掉
    expect(byKey.get("exp/a|e2")).toBe("passed"); // 来自补跑 run(最新)
    expect(byKey.get("exp/b|e1")).toBe("passed");
    expect(results).toHaveLength(3);
  });

  it("同 (experiment, eval) 多 attempt 整批取自含它的最新 run,不跨 run 混装", async () => {
    root = await mkdtemp(join(tmpdir(), "niceeval-loader-"));
    await writeRun("2026-01-01T00-00-00", "2026-01-01T00:00:00.000Z", [
      result("exp/a", "e1", "passed", { fingerprint: "old" }),
    ]);
    await writeRun("2026-01-02T00-00-00", "2026-01-02T00:00:00.000Z", [
      result("exp/a", "e1", "failed", { fingerprint: "new" }),
      result("exp/a", "e1", "passed", { fingerprint: "new" }),
    ]);

    const results = (await loadLatestResultsPerEval(root)) as Array<{ fingerprint: string }>;
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.fingerprint === "new")).toBe(true);
  });
});
