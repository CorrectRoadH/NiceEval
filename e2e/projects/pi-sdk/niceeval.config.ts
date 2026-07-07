import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: pi-sdk(fromPiAgentEvents)", en: "e2e: pi-sdk (fromPiAgentEvents)" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 120_000,
  maxConcurrency: 2,
});
