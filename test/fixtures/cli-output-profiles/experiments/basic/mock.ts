import { defineExperiment } from "niceeval";
import { mockAgent } from "../../agents/mock.ts";

export default defineExperiment({
  description: "回归夹具:CLI --output profile 机制(单条恒定通过的 eval)",
  agent: mockAgent(),
  model: "mock",
  runs: 1,
  earlyExit: false,
  evals: "*",
});
