import type { AgentProfile } from "../../shared/profile.ts";

// MCP 命名空间是协议现实,不抹平;result 消息带 usage/total_cost_usd。
export default {
  weatherToolName: "mcp__demo-tools__get_weather",
  calcToolName: "mcp__demo-tools__calculate",
  usage: true,
  sandboxTools: false,
} satisfies AgentProfile;
