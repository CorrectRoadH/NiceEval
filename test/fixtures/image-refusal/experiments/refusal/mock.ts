import { defineExperiment } from "niceeval";
import { refusalAgent } from "../../agents/refusal.ts";

// 一个实验 = 一个配置:全程用「拒绝识图」的 mock agent 跑一遍 image-understanding。
export default defineExperiment({
  description: "回归夹具:模型拒绝识图时,eval 该 failed",
  agent: refusalAgent(),
  model: "mock-refusal",
  runs: 1,
  earlyExit: false,
  evals: "*",
});
