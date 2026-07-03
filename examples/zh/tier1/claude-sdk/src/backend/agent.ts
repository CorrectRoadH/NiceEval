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
import { pendingApprovals } from "./pending-approvals.ts";

// HITL 演示:只有 calculate 需要人工审批。实测确认(见 README「Claude Agent
// SDK API 速记」)——MCP 命名空间下,tool_use 块里的真实工具名是
// `mcp__<server>__<tool>`,不是裸的 `calculate`。这个字符串同时也是
// ui-stream.ts 判断要不要发 tool-approval-request 的依据,两处必须一致。
const GATED_TOOL_NAME = "mcp__demo-tools__calculate";

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
      // 无人值守的 HTTP 服务没有终端可以答复权限提示,所以两个工具分两条路:
      // get_weather 进 allowedTools 白名单直接放行;calculate 留给下面的
      // canUseTool 做 HITL 审批。
      //
      // 这里踩了一个坑,记录一下:一开始两个工具都塞进
      // allowedTools(用通配符 `mcp__demo-tools__*`)配 permissionMode:
      // 'dontAsk',实测 canUseTool 从来不会被调用——SDK 自己的文档写得很
      // 明白,allowedTools 命中的工具"execute automatically without asking
      // for approval",dontAsk 模式下没命中白名单的工具则是直接 auto-deny
      // (同一条 SDKPermissionDeniedMessage 的注释里写着 "dontAsk mode" 也是
      // 这个 deny short-circuit 的触发场景之一)。换句话说 dontAsk 模式下
      // canUseTool 根本不在决策路径里,allowedTools 之外的工具连"问"都不会
      // 问就被拒了。要让 calculate 真的走到 canUseTool 的 ask 流程,必须用
      // permissionMode: 'default'(会为未列入白名单的工具触发权限询问,
      // headless 场景下这个"询问"就是回调 canUseTool),并且不能把 calculate
      // 放进 allowedTools。
      allowedTools: ["mcp__demo-tools__get_weather"],
      permissionMode: "default",
      // 让 SDK 额外产出 stream_event 消息(原始 API 流事件),前端才能逐 token
      // 渲染回复,而不是等整轮结束。
      includePartialMessages: true,
      // HITL:calculate 调用前先暂停,等前端用户点击"允许"/"拒绝"。
      // opts.toolUseID 与 tool_use 块的 id 是同一个值,ui-stream.ts 发
      // tool-approval-request 时把 approvalId 设成这个 id,前端点按钮时把它
      // 原样带回 POST /api/chat/approve——三处用的是同一个字符串。
      // SSE 连接这轮全程不关:query() 的 async generator 挂在这个 Promise
      // 上,不产出新消息,直到 resolve 才继续;不是 AI SDK 自己那种"结束流、
      // 客户端重发全部历史"的 resume 模式。
      canUseTool: async (toolName, input, opts) => {
        // 注意:PermissionResult 的 TS 类型把 `updatedInput` 标成可选,但 CLI
        // 子进程那边校验用的 zod schema 实测要求 allow 分支必须带上
        // updatedInput(一个 record)——只回 `{behavior:'allow'}` 会在控制
        // 通道里被拒(ZodError: invalid_type,收到 undefined)。回传原样的
        // input 就够了,这里没有修改参数的需求。
        if (toolName !== GATED_TOOL_NAME) return { behavior: "allow", updatedInput: input };
        const approved = await new Promise<boolean>((resolve) => {
          pendingApprovals.set(opts.toolUseID, resolve);
        });
        return approved
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "用户拒绝了这次调用" };
      },
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });
}
