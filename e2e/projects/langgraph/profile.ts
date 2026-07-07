import type { AgentProfile } from "../../shared/profile.ts";

// server.py 的自定义 JSON 帧协议:裸工具名;协议帧里没有 usage。
export default {
  weatherToolName: "get_weather",
  calcToolName: "calculate",
  usage: false,
  sandboxTools: false,
} satisfies AgentProfile;
