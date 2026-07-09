import type { AgentProfile } from "../../shared/profile.ts";

// codex 是沙箱型 coding agent(实测见 memory/):同 claude-code 没有 weather/calculate 工具、
// 不支持 HITL;turn.completed 带 usage;文件系统落在容器里,eval 一律走 t.sandbox.*
// (workspace: "sandbox")。codex 没有原生 Skill 工具——skillDetection: "shell" 让 shared
// factory 改从"读没读过 skill 文件"这个行为痕迹认,而不是某个工具调用。MCP 工具命名是
// "<server>.<tool>"(点分隔,见 src/o11y/parsers/codex.ts 的 mcp_tool_call 分支),
// 不是 claude-code 那套 mcp__ 命名空间——两者都是从 docker 沙箱里实测抄回来的真实名字。
export default {
  weatherToolName: null,
  calcToolName: null,
  searchToolName: null,
  usage: true,
  sandboxTools: true,
  workspace: "sandbox",
  skillName: "effect-ts",
  skillDetection: "shell",
  skillInstallDir: ".agents/skills",
  mcpToolName: "e2e.get-sum",
} satisfies AgentProfile;
