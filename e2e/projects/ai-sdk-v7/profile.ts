import type { AgentProfile } from "../../shared/profile.ts";

// UI Message Stream 协议:裸工具名;协议帧里没有 usage(见 docs/e2e-ci.md 第 2 节)。
export default {
  weatherToolName: "get_weather",
  calcToolName: "calculate",
  usage: false,
  sandboxTools: false,
} satisfies AgentProfile;
