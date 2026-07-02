import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "AI SDK v7 助手示例", en: "AI SDK v7 assistant example" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 120_000,
  maxConcurrency: 4,
});
