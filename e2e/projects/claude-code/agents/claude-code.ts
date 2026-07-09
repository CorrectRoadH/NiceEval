// 基线 agent:无侵入用 niceeval 内置 claudeCodeAgent 适配器,接 DeepSeek 代理
// (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL 走 .env;模型由各 experiment 的 model 字段钉死)。
// ci / verdicts 实验用这个;features 实验用 claude-code-features.ts(额外挂 skills + MCP server)。
import { claudeCodeAgent } from "niceeval/adapter";

export default claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
});
