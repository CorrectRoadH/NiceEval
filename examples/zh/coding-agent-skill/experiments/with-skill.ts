import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

// 在沙箱 setup 时把本地 skill 写入 CLAUDE.md，让 claude CLI 自动读取。
// 这模拟了团队把内部最佳实践打包成 skill 分发给所有 coding agent 的场景。
const zodSkill = readFileSync(join(__dir, "../skills/zod.md"), "utf-8");
const baseAgent = claudeCodeAgent();
const zodAgent = {
  ...baseAgent,
  name: "claude-code+zod-skill",
  async setup(sb, ctx) {
    const cleanup = await baseAgent.setup?.(sb, ctx);
    await sb.writeFiles({ "CLAUDE.md": zodSkill }, "/home/sandbox/workspace");
    return cleanup;
  },
} satisfies typeof baseAgent;

// 实验组：注入了 zod skill 的 Claude Code。
// 期望：Zod API 使用正确率显著高于对照组（baseline）。
export default defineExperiment({
  description: "claude-code + zod skill（本地注入）",
  agent: zodAgent,
  model: "claude-sonnet-4-6",
  sandbox: "docker",
  runs: 3,
  earlyExit: false,
  budget: 10,

  // 只跑 Zod 相关 eval（排除 ponytail 系列）
  evals: (id) => !id.startsWith("ponytail-"),
});
