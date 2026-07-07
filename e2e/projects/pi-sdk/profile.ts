import type { AgentProfile } from "../../shared/profile.ts";

// pi-agent-core:裸工具名;message_end 的 AssistantMessage.usage 有用量。
export default {
  weatherToolName: "get_weather",
  calcToolName: "calculate",
  usage: true,
  sandboxTools: false,
} satisfies AgentProfile;
