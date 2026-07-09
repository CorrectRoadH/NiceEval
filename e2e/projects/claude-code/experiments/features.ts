import { featuresExperiment } from "../../../shared/experiments.ts";
import agent from "../agents/claude-code-features.ts";

// 只跑 "feature-" 前缀的正例(skill-used / mcp-tool);反例留在 ci.ts 用基线 agent 跑。
export default {
  ...featuresExperiment(agent, { runs: 2, budget: 2 }),
  model: "deepseek-v4-flash",
};
