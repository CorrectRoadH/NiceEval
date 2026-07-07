import { describe, expect, it } from "vitest";
import { judgeProbeTargets } from "./run.ts";
import type { JudgeConfig } from "../types.ts";

// judge 预检的目标收敛:只探测「实际要跑、且源码里出现 judge 字样」的 eval 的生效配置。
// 这是对 memory/judge-config-precheck-hard-fails-without-key 的修复守护——
// 全局配了 judge 但选中的 eval 都不用时,不能再因 judge key / 端点问题拦下整次运行。
describe("judgeProbeTargets", () => {
  const configJudge: JudgeConfig = { model: "gpt-5.4" };

  it("skips probing when no selected eval mentions judge", () => {
    const evals = [
      { source: `t.check(t.reply, includes("2"));`, judge: undefined },
      { source: `await t.sandbox.exec("pnpm test");`, judge: undefined },
    ];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([]);
  });

  it("probes config-level judge when a selected eval mentions judge", () => {
    const evals = [
      { source: `t.judge.autoevals.closedQA("did it summarize?");`, judge: undefined },
      { source: `t.check(t.reply, includes("ok"));`, judge: undefined },
    ];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([configJudge]);
  });

  it("resolves eval-level judge over config-level, like attempt resolution", () => {
    const evalJudge: JudgeConfig = { model: "deepseek-v4", baseUrl: "http://localhost:8787/v1" };
    const evals = [{ source: `t.judge.autoevals.factuality("2")`, judge: evalJudge }];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([evalJudge]);
  });

  it("dedupes identical effective configs across evals", () => {
    const evals = [
      { source: `t.judge.autoevals.closedQA("a")`, judge: undefined },
      { source: `t.judge.autoevals.closedQA("b")`, judge: undefined },
    ];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([configJudge]);
  });

  it("returns nothing when judge is used but no config exists (runtime env fallback)", () => {
    const evals = [{ source: `t.judge.autoevals.closedQA("a")`, judge: undefined }];
    expect(judgeProbeTargets(evals, undefined)).toEqual([]);
  });

  it("does not match judge as part of a longer identifier", () => {
    const evals = [{ source: `const prejudged = true;`, judge: undefined }];
    expect(judgeProbeTargets(evals, configJudge)).toEqual([]);
  });
});
