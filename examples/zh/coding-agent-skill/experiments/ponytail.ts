import { defineExperiment, claudeCodeAgent } from "fasteval";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

// 把 ponytail SKILL.md 写入工作区 CLAUDE.md，让 claude CLI 自动读取。
// ponytail 是一个"懒惰高级开发者"决策梯：先查现有工具、先用标准库、先写最少代码。
const ponytailSkill = readFileSync(join(__dir, "../skills/ponytail.md"), "utf-8");
const baseAgent = claudeCodeAgent();
const ponytailAgent = {
  ...baseAgent,
  name: "claude-code+ponytail",
  async setup(sb, ctx) {
    const cleanup = await baseAgent.setup?.(sb, ctx);
    await sb.writeFiles({ "CLAUDE.md": ponytailSkill }, "/home/sandbox/workspace");
    return cleanup;
  },
} satisfies typeof baseAgent;

// 实验组：注入 ponytail plugin 的 Claude Code。
// 期望：安全意识更强、复用率更高、代码更简洁。
export default defineExperiment({
  description: "claude-code + ponytail plugin",
  agent: ponytailAgent,
  model: "claude-sonnet-4-6",
  sandbox: "docker",
  runs: 3,
  earlyExit: false,
  budget: 15,

  // 只跑 ponytail- 开头的 eval
  evals: (id) => id.startsWith("ponytail-"),
});
