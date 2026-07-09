// 基线 agent:无侵入用 niceeval 内置 codexAgent 适配器,接 s2a 代理
// (CODEX_API_KEY / CODEX_BASE_URL 走 .env;模型由各 experiment 的 model 字段钉死)。
// ci / verdicts 实验用这个;features 实验用 codex-features.ts(额外挂 skills + MCP server)。
//
// 沙箱内 `codex exec` 已经带 --dangerously-bypass-approvals-and-sandbox(见
// src/agents/codex.ts),即 Codex 自己的 OS 级沙箱(bwrap/seatbelt)整段被跳过、
// 隔离全部交给 Docker 容器本身——这与 memory/e2e-suite-landing-gotchas.md 记录的
// codex-sdk(@openai/codex-sdk,HTTP demo 应用用的是另一条 SDK 路径)在 GH Actions
// runner 上的 bwrap loopback 问题不是同一回事,原则上不需要再设 CODEX_SANDBOX_MODE;
// 本地只验证过 macOS Docker,真上 Linux CI runner 需要再确认一次。
import { codexAgent } from "niceeval/adapter";

export default codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
});
