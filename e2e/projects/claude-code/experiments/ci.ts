import { ciExperiment } from "../../../shared/experiments.ts";
import agent from "../agents/claude-code.ts";

// 便宜档:DeepSeek 代理下的 deepseek-v4-flash,和 e2e/apps 其它项目同一凭据映射
// (memory/origin-examples-real-ai-credentials.md)。"feature-" 前缀的正例排除在外——
// 它们需要 claude-code-features.ts 那个挂了 skills/MCP 的 agent,见 experiments/features.ts。
export default {
  ...ciExperiment(agent, { excludeIdPrefixes: ["feature-"], runs: 2, budget: 2 }),
  model: "deepseek-v4-flash",
};
