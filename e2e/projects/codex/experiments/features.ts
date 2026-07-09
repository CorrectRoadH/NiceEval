import { featuresExperiment } from "../../../shared/experiments.ts";
import agent from "../agents/codex-features.ts";

// 只跑 "feature-" 前缀的正例(skill-used / mcp-tool);反例留在 ci.ts 用基线 agent 跑。
export default {
  ...featuresExperiment(agent, { runs: 2, budget: 2 }),
  model: "gpt-5.4-mini",
};
