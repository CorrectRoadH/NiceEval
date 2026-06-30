import { defineConfig } from "fasteval";
import { riddleWebAgent } from "./agents/riddle-game.ts";

export default defineConfig({
  // web agent 由 examples/ai-sdk/ai-sdk-agent 单独启动。
  // fasteval 通过 defineAgent adapter 按 RIDDLE_AGENT_URL 调它的 HTTP 协议。
  sandbox: "auto",

  agents: [riddleWebAgent],
  defaultAgent: "riddle-web",

  // judge 模型:用来做开放式质量评测(谜题是否合理、提示是否得当)。
  judge: { model: "gpt-4o-mini" },

  timeoutMs: 60_000,    // 进程内调用很快,60s 足够
  maxConcurrency: 4,    // 并发跑 4 个 eval
});
