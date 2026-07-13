import { ciExperiment } from "../../../shared/experiments.ts";
import agent from "../agents/codex.ts";

// 便宜档:s2a 代理下的 gpt-5.4-mini,和 e2e/apps/codex-sdk 同一凭据映射
// (memory/origin-examples-real-ai-credentials.md)。"feature-" 前缀的正例排除在外——
// 它们需要 codex-features.ts 那个挂了 skills/MCP 的 agent,见 experiments/features.ts。
// "native-plugin-" 前缀同理排除——它需要 codex-native-plugin.ts 那个挂了 Native Plugin 的
// agent,见 experiments/native-plugin.ts;基线 agent 没连这个 marketplace,读 agent-setup.json
// 的 nativePlugins 会必然失败。"multi-skill-" 前缀同理排除——它需要 codex-multi-skill.ts
// 那个挂了多 Skill 仓库(anthropics/skills)选择性安装的 agent,见 experiments/multi-skill.ts;
// 基线 agent 没装这个 repo Skill,读 .agents/skills/template/SKILL.md 会必然失败。
export default {
  ...ciExperiment(agent, { excludeIdPrefixes: ["feature-", "native-plugin-", "multi-skill-"], runs: 2, budget: 2 }),
  model: "gpt-5.4-mini",
};
