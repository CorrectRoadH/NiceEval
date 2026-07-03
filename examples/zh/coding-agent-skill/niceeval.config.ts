import { defineConfig } from "niceeval";

export default defineConfig({
  // 评判模型：与被测 agent(claude)解耦。judge 走 OpenAI-compatible 端点
  // (OPENAI_BASE_URL)，模型名必须是该端点支持的——写 claude-* 会直接 503。
  judge: { model: "gpt-5.4" },

  timeoutMs: 180_000,  // 3 分钟：Docker 启动 + 编码任务通常在此范围内完成
  maxConcurrency: 2,   // 同时跑 2 个 eval；避免 Docker 资源争抢
});
