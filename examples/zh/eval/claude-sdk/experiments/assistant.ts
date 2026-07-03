// 把 agents/claude-sdk.ts 接成一个可跑的实验。这个示例只有一个 agent、不比较模型,
// 所以不需要 compare-models/ 那样的多文件分组 —— 一个 defineExperiment 就够了。
import { defineExperiment } from "niceeval";
import agent from "../agents/claude-sdk.ts";

export default defineExperiment({
  description: "claude-sdk:真实 DeepSeek 后端",
  agent,
  runs: 1,
});
