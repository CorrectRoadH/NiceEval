import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: ai-sdk-v7(UI Message Stream 官方适配)", en: "e2e: ai-sdk-v7 (UI Message Stream adapter)" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 60_000,
});
