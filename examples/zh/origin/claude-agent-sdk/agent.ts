// 真实调用 @anthropic-ai/claude-agent-sdk 的 query()。
// 需要 ANTHROPIC_API_KEY,且需要能找到 claude-code 可执行文件(SDK 把它作为
// optional dependency 一起装;如果包管理器跳过了 optional deps,要另装
// @anthropic-ai/claude-code 并设置 pathToClaudeCodeExecutable)。
//
// 会话形态按官方 sessions 文档的"多用户服务"基线:每轮一次 query(),用
// resume 携带上一轮的 session_id 找回历史(SDK 落盘在 ~/.claude/projects/)。
// 前端从消息流里自己拿 session_id(system/init 和 result 消息都带),下一轮
// 随请求带回来——服务端零会话状态。

import { createSdkMcpServer, query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { demoTools } from "./tools.ts";

// Claude Agent SDK 的 model 选项接受 'claude-sonnet-5' / 'claude-opus-4-8' 这类
// 别名(见 SDK 自带的 Options.model 文档注释),也接受任何模型服务商自己的 model id——这里默认
// 走 DeepSeek 的 Anthropic 兼容端点,通过 AGENT_MODEL 可覆盖。
const MODEL = process.env.AGENT_MODEL ?? "deepseek-v4-flash";

const SYSTEM_PROMPT = [
  "你是 niceeval 仓库里的一个示例助手,名字叫“小天”。",
  "你有两个工具:get_weather(查询城市天气)和 calculate(算术表达式求值)。",
  "只要问题涉及天气或算式,必须调用对应工具拿到结果,不要凭空编造数字。",
  "回答使用简体中文,简洁直接,不需要多余的寒暄。",
].join("\n");

// SDK 内嵌的 MCP server 进程级建一次即可,每次 query() 复用同一个实例。
const demoToolsServer = createSdkMcpServer({
  name: "demo-tools",
  version: "1.0.0",
  tools: demoTools,
});

export function runTurn(message: string, resumeSessionId: string | undefined): Query {
  return query({
    prompt: message,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: MODEL,
      // 关掉内置工具(Bash/Read/...),这个 demo 只暴露我们自己的两个 MCP 工具。
      tools: [],
      mcpServers: { "demo-tools": demoToolsServer },
      // 无人值守的 HTTP 服务没有终端可以答复权限提示。官方 permissions 文档
      // 对这种"固定工具面的 headless agent"给的组合是:allowedTools 白名单 +
      // permissionMode: "dontAsk"——名单内的工具直接放行,名单外硬拒绝,
      // 而不是整体 bypassPermissions。
      allowedTools: ["mcp__demo-tools__*"],
      permissionMode: "dontAsk",
      // 让 SDK 额外产出 stream_event 消息(原始 API 流事件),前端才能逐 token
      // 渲染回复,而不是等整轮结束。
      includePartialMessages: true,
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });
}
