// features 实验专用:同一个 codex adapter,额外挂 skills + MCP server(同 claude-code 项目
// 的选型理由:Effect-TS/skills 只有一个 skill、触发条件清晰;MCP server 用官方
// @modelcontextprotocol/server-everything 的确定性 get-sum 工具)。
import { codexAgent } from "niceeval/adapter";

export default codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  skills: [{ kind: "repo", source: "Effect-TS/skills" }],
  mcpServers: [{ name: "e2e", command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] }],
});
