// e2e 共享 experiment factory(docs/e2e-ci.md 第 4 节的 L0 档):
// runs: 3 + earlyExit 吸收真实模型的单次抖动;连续 3 次不过的是真回归,矩阵照样红。
// verdicts 实验只排 deliberate-* fixture,由 verify.mjs 以"期望 exit 1"消费。
import { defineExperiment } from "niceeval";
import type { Agent } from "niceeval";

export function ciExperiment(agent: Agent) {
  return defineExperiment({
    description: `ci:共享套件 L0 门禁(${agent.name})`,
    agent,
    runs: 3,
    earlyExit: true,
    evals: (id) => !id.startsWith("deliberate-"),
    budget: 1,
  });
}

export function verdictsExperiment(agent: Agent) {
  return defineExperiment({
    description: `verdicts:故意红 fixture,期望进程 exit 1(${agent.name})`,
    agent,
    runs: 1,
    evals: (id) => id.startsWith("deliberate-"),
    budget: 1,
  });
}
