import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";

// ponytail 基准组：裸 Claude Code，没有 ponytail skill。
// 与 ponytail 实验组对比，衡量 skill 在安全性、复用率、代码精简度上的实际收益。
export default defineExperiment({
  description: "claude-code（无 ponytail skill，对照组）",
  agent: claudeCodeAgent(),
  model: "claude-sonnet-4-6",
  sandbox: "docker",
  runs: 3,
  earlyExit: false,
  budget: 15,

  // 只跑 ponytail- 开头的 eval，与 ponytail 实验组保持相同覆盖范围
  evals: (id) => id.startsWith("ponytail-"),
});
