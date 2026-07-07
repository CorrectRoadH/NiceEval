import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "AI SDK v7 HTTP 无侵入示例", en: "AI SDK v7 HTTP non-invasive example" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 60_000,
});
