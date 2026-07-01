import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";

// 对照组：裸 Claude Code，没有任何 skill 注入。
// 同一批 eval、同一模型，唯一差异是没有 zod skill。
// agent 需要从零猜 Zod API，通常会退回到手写类型守卫或 JSON.parse + try/catch。
//
// 把这组与 with-skill 对比，通过率差值即为该 skill 的实际收益。
export default defineExperiment({
  description: "claude-code（无 skill，对照组）",
  // 只跑 Zod 相关 eval（排除 ponytail 系列）
  evals: (id) => !id.startsWith("ponytail-"),
  agent: claudeCodeAgent(),
  model: "claude-sonnet-4-6",
  sandbox: "docker",
  runs: 3,
  earlyExit: false,
  budget: 10,
});
