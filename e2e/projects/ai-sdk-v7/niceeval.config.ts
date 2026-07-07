import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: ai-sdk-v7(UI Message Stream 官方适配)", en: "e2e: ai-sdk-v7 (UI Message Stream adapter)" },
  judge: { model: "gpt-5.4" },
  // 对齐其它项目的 120s:gpt-5.4 judge 一次评分就可能接近 1 分钟,60s 会把
  // "对话 3 秒跑完、评分还在路上"的 attempt 误判成 errored(tool-failure 首跑撞过)。
  timeoutMs: 120_000,
});
