import { defineConfig } from "niceeval";

// 注:这个 app 的 .env 把标准的 OPENAI_API_KEY / OPENAI_BASE_URL 挪用给了 DeepSeek
// (agent.py 里 ChatOpenAI 直接读这两个 env 名)。niceeval 的 judge(t.judge.autoevals.*)
// 兜底链路最后也会读这两个名字,和应用自己的凭证会撞车——真的要用 judge 时在 .env 里另配
// NICEEVAL_JUDGE_KEY / NICEEVAL_JUDGE_BASE(judge.ts 里优先级最高),judge 走独立凭证,
// 不和应用的模型配置互相干扰。
export default defineConfig({
  name: { "zh-CN": "LangGraph 示例", en: "LangGraph example" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 120_000,
  // 被测应用是用户自己起的长驻服务,别开太高并发。
  maxConcurrency: 2,
  // span 接收钉在 OTLP 标准端口:起应用时 OTEL_EXPORTER_OTLP_ENDPOINT 指过来即可(见 README)。
  telemetry: { port: 4318 },
});
