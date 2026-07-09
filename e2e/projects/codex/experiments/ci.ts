import { ciExperiment } from "../../../shared/experiments.ts";
import agent from "../agents/codex.ts";

// 便宜档:s2a 代理下的 gpt-5.4-mini,和 e2e/apps/codex-sdk 同一凭据映射
// (memory/origin-examples-real-ai-credentials.md)。"feature-" 前缀的正例排除在外——
// 它们需要 codex-features.ts 那个挂了 skills/MCP 的 agent,见 experiments/features.ts。
export default {
  ...ciExperiment(agent, { excludeIdPrefixes: ["feature-"], runs: 2, budget: 2 }),
  model: "gpt-5.4-mini",
};
