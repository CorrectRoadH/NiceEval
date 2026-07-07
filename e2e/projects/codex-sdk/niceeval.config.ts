import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: codex-sdk(fromCodexThreadEvents)", en: "e2e: codex-sdk (fromCodexThreadEvents)" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 180_000,
  // Codex CLI 真的在 workspace/ 里跑命令/改文件,比其它项目都重,别开太高并发。
  maxConcurrency: 2,
});
