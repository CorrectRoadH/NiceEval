import type { AgentProfile } from "../../shared/profile.ts";

// claude-code 是沙箱型 coding agent(实测见 memory/):没有 weather/calculate 工具、不支持
// HITL;result 消息带 usage;文件系统落在容器里,eval 一律走 t.sandbox.*(workspace: "sandbox"),
// 不读宿主磁盘。原生 Skill 工具可直接断言(calledTool("Skill", …)),MCP 工具走
// mcp__<server>__<tool> 命名空间——两者都是从 docker 沙箱里实测抄回来的真实名字。
export default {
  weatherToolName: null,
  calcToolName: null,
  searchToolName: null,
  usage: true,
  sandboxTools: true,
  workspace: "sandbox",
  persistentMemory: true,
  skillName: "effect-ts",
  skillDetection: "tool",
  skillInstallDir: ".claude/skills",
  mcpToolName: "mcp__e2e__get-sum",
} satisfies AgentProfile;
