// features 实验专用:同一个 claude-code adapter,额外挂 skills + MCP server。
// skill 选 Effect-TS/skills——只有一个 skill(effect-ts)、触发条件在 SKILL.md 里写得很明确,
// 装/用起来都稳定(候选 anthropics/skills 内容太大、清空环境每次全装太贵,弃用)。
// MCP server 用官方 @modelcontextprotocol/server-everything:自带确定性的 get-sum 工具,
// 不用为了测"MCP 挂载"再自己写一个假 server。
import { claudeCodeAgent } from "niceeval/adapter";

export default claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  skills: ["Effect-TS/skills"],
  mcpServers: [{ name: "e2e", command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] }],
});
