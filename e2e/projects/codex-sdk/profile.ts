import { fileURLToPath } from "node:url";
import type { AgentProfile } from "../../shared/profile.ts";

// Codex 是 coding agent:没有 weather/calculate 工具、不支持 HITL;
// turn.completed 带 usage;create-file / run-command 落在被测应用的 workspace/ 里。
export default {
  weatherToolName: null,
  calcToolName: null,
  usage: true,
  sandboxTools: true,
  workspaceDir: fileURLToPath(new URL("../../apps/codex-sdk/workspace", import.meta.url)),
} satisfies AgentProfile;
