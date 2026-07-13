import { ciExperiment } from "../../../shared/experiments.ts";
import agent from "../agents/claude-code.ts";

// 便宜档:DeepSeek 代理下的 deepseek-v4-flash,和 e2e/apps 其它项目同一凭据映射
// (memory/origin-examples-real-ai-credentials.md)。"feature-" 前缀的正例排除在外——
// 它们需要 claude-code-features.ts 那个挂了 skills/MCP 的 agent,见 experiments/features.ts。
// "local-skill-" 前缀同理排除——它需要 claude-code-local-skill.ts 那个挂了本地 Skill
// fixture 的 agent,见 experiments/local-skill.ts;基线 agent 没装这个 fixture,读
// .claude/skills/local-smoke/SKILL.md 会必然失败。"native-plugin-" 前缀同理排除——它需要
// claude-code-native-plugin.ts 那个挂了 Native Plugin 的 agent,见 experiments/native-plugin.ts;
// 基线 agent 没连这个 marketplace,读 agent-setup.json 的 nativePlugins 会必然失败。
// "multi-skill-" 前缀同理排除——它需要 claude-code-multi-skill.ts 那个挂了多 Skill 仓库
// (anthropics/skills)选择性安装的 agent,见 experiments/multi-skill.ts;基线 agent 没装
// 这个 repo Skill,读 .claude/skills/template/SKILL.md 会必然失败。
export default {
  ...ciExperiment(agent, {
    excludeIdPrefixes: ["feature-", "local-skill-", "native-plugin-", "multi-skill-"],
    runs: 2,
    budget: 2,
  }),
  model: "deepseek-v4-flash",
};
