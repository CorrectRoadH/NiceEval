import { defineExperiment } from "niceeval";
import agent from "../agents/claude-code-multi-skill.ts";

// 独立实验(plan/docs-code-alignment-closeout.md §3「测试矩阵要求」"选择多 Skill 仓库中的
// 指定 Skill"矩阵格):只选一个专用 eval(multi-skill-selected),runs: 1,避免复用 features
// 实验挂的 MCP/judge 成本——multi-skill-selected 本身不调用 judge。eval id 用
// "multi-skill-" 前缀,不会被 features.ts 的 "feature-" 选择器、local-skill.ts 的
// "local-skill-" 选择器或 native-plugin.ts 的 "native-plugin-" 选择器捡走;ci.ts 显式把该
// 前缀加进 excludeIdPrefixes。
export default defineExperiment({
  description: `multi-skill:多 Skill 仓库选择性安装验收(${agent.name})`,
  agent,
  runs: 1,
  evals: (id) => id === "multi-skill-selected",
  budget: 1,
  model: "deepseek-v4-flash",
});
