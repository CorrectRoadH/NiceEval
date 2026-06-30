import { defineExperiment } from "fasteval";
import { riddleWebAgent } from "../agents/riddle-game.ts";

// 对比不同 LLM 的游戏质量。
//
// 同一批 eval、同一个 agent 适配器，只换模型。
// fasteval 会为每个模型单独出报告，通过率与 judge 分数一目了然。
//
// 典型问题：GPT-4o-mini 会不会在提示里直接泄底？Claude Haiku 的谜题质量如何？
// 跑完 `npx fasteval view` 可以并排对比各模型表现。
export default defineExperiment({
  description: "谜语游戏：多模型质量对比",
  agent: riddleWebAgent,
  model: [
    "gpt-4o-mini",
    "gpt-4o",
    // 如果你用的是 Anthropic 代理，取消注释：
    // "claude-haiku-4-5-20251001",
    // "claude-sonnet-4-6",
  ],
  runs: 3,          // 每个模型跑 3 次,评估稳定性
  earlyExit: false, // 要完整分布而不是首次通过就停
  budget: 5,        // $5 上限(进程内调用很便宜)
});
