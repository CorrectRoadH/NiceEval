import { defineConfig } from "niceeval";

// judge 走独立凭证 NICEEVAL_JUDGE_KEY / NICEEVAL_JUDGE_BASE(本项目 .env),
// 不与被测应用自己的 OPENAI_* 凭证互相干扰(应用的 .env 在 e2e/apps/langgraph/)。
export default defineConfig({
  name: { "zh-CN": "e2e: langgraph(自定义 SSE 帧手写映射)", en: "e2e: langgraph (custom SSE frame mapping)" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 120_000,
  maxConcurrency: 2,
});
