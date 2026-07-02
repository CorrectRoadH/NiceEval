# Claude Agent SDK 示例

这是一个**独立示例应用**,演示用 [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
(把 Claude Code CLI 包成子进程的 harness SDK,`query()` 返回 `SDKMessage` 流——**不是**普通
Messages API 的 `@anthropic-ai/sdk`)搭一个带工具调用的 agent 后端长什么样。

这个目录不依赖、不 import `niceeval`,没有 `adapter/`、`evals/`、`niceeval.config.ts`——它只是
仓库根 README「Agent Frameworks」路线图里 “Claude SDK” 一项配的文档/示例素材,**不是**一个可用的
niceeval 接入实现。

每次对话都是真实的 `query()` 调用——没有 mock 模式、没有离线开关。两个工具(`get_weather` /
`calculate`)背后是确定性模拟数据,那只是"假天气",跟"是否真的调用了模型"是两回事。

## 前后端接口:SDKMessage 流就是协议

SDK 官方 hosting 指南(`code.claude.com/docs/en/agent-sdk/hosting`)和配套
cookbook(`claude-cookbooks/claude_agent_sdk/hosting` 里的 SSE server)给聊天后端定的形状
就是:**把 `query()` 产出的 SDKMessage 流序列化后经 SSE 转发给前端**,而不是折叠成一个自造的
`{reply, toolCalls}` JSON。这个 demo 照此实现:

- `POST /api/chat`(body `{message, sessionId?}`)响应 `text/event-stream`,每帧 `data:` 是
  一个原样的 `SDKMessage`(`system/init`、`stream_event`、`assistant`、`user`、`result`)。
- `options.includePartialMessages: true` 让 SDK 额外产出 `stream_event`(原始 API 流事件),
  前端拿 `content_block_delta` / `text_delta` 逐 token 渲染回复。
- 工具调用不需要旁路记录:assistant 消息里的 `tool_use` 块和 user 消息里的 `tool_result` 块
  (按 `tool_use_id` 配对)本身就带全了,前端直接按块渲染。
- 会话按官方 sessions 文档的"多用户服务"基线:每轮一次 `query()` + `options.resume`;
  `session_id` 在 `system/init` 和 `result` 消息里,由**前端**保存、下一轮带回——服务端零会话状态。

## 目录结构

- `tools.ts`:两个工具的纯逻辑实现(`WEATHER_TABLE`/`getWeather`/`calculate`,确定性模拟数据,
  `calculate` 是自写的小型递归下降算术求值器,不用 `eval`/`Function`),包成
  Claude Agent SDK `tool()` 形状导出为 `demoTools`。
- `agent.ts`:`SYSTEM_PROMPT`、`MODEL`、进程级的 `createSdkMcpServer` 实例,以及真实调用
  `query()` 的 `runTurn(message, resumeSessionId)`——返回 SDKMessage 的 AsyncGenerator,
  不在这层做任何折叠。
- `server.ts`:HTTP 层,一个 `node:http` 服务器(无框架)。
  - `GET /healthz` → `{ok:true}`
  - `POST /api/chat`,body `{message, sessionId?}` → SSE,逐帧转发 SDKMessage;浏览器断开时
    调 `query.interrupt()` 中断这轮 agent。
  - `GET /` → 返回 `public/index.html`
- `public/index.html`:单文件前端,inline `<style>`/`<script>`,`fetch()` 读 SSE 流
  (EventSource 只支持 GET,所以手动按空行切帧),流式渲染文本、实时展示 tool_use/tool_result,
  没有构建步骤、没有框架。
- `package.json`:`"private": true`,自带 `pnpm-workspace.yaml`(`packages: []`)使它脱离仓库根
  workspace,是完全独立的 npm 项目。
- `.env.example`:`ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `AGENT_MODEL` / `PORT`。

## Claude Agent SDK API 速记(2026-07 核实)

以下结论来自 SDK 自带的 `sdk.d.ts` 类型声明(`@anthropic-ai/claude-agent-sdk@0.3.198`)以及
`code.claude.com/docs/en/agent-sdk/typescript`:

- 调用面:`query({ prompt, options }) → AsyncGenerator<SDKMessage>`。`SDKMessage` 是一个成员很多
  (~30+)的联合类型,核心是 `assistant` / `user` / `result` / `system`;tool_use 是 assistant 消息
  content 里的标准 Anthropic 块,tool_result 通过 user 消息块回流,`tool_use.id` 与
  `tool_result.tool_use_id` 显式配对。这个 demo 没有解析这条流去抠 tool 调用——直接在工具 handler
  里记录 `{name, input, output}`,更简单可靠;想看原始块结构可以自己在 `runTurn` 里打印
  `stream` 的每条消息。
- 系统提示:`options.systemPrompt`,可以是纯字符串,也可以是
  `{type:'preset', preset:'claude_code', append}` 这种预设+追加的形式。
- 自定义工具:`tool(name, description, zodShape, handler)` 建工具,`createSdkMcpServer({name, tools})`
  打包成一个进程内 MCP server,再通过 `options.mcpServers` 挂上去——SDK 的工具模型确实是走 MCP
  wiring,不是随便传个函数数组。
- 权限:默认 `permissionMode: 'default'` 会为每次工具调用弹出交互式权限提示。这个 demo 是无人
  值守的 HTTP 服务,没有终端去响应提示——实测下来模型会跳过工具调用,天气问题直接编数字、算术
  问题干脆回复"需要先授权"。`agent.ts` 里显式设置了 `permissionMode: 'bypassPermissions'` +
  `allowDangerouslySkipPermissions: true` 来跳过这个提示;这两个工具是我们自己写的确定性逻辑,
  不是危险操作,所以整体 bypass 是合理的——换成不受信输入的场景应该用 `canUseTool` 按工具名做
  白名单,而不是整体 bypass。
- 会话续接:`options.resume: <session_id>`(接着某个具体会话)、`options.continue: true`(接最近一次
  会话)、`options.forkSession: true`(复制历史开新分支)。每次 `query()` 都会重新起一个 CLI 子进程——
  会话记忆完全靠 `resume` 找回历史,不是进程内状态。
- Model id:`options.model` 接受 `'claude-sonnet-5'` / `'claude-opus-4-8'` / `'claude-fable-5'` 这类
  别名,也接受模型服务商自己的 model id(比如接 DeepSeek 的 Anthropic 兼容端点时用
  `deepseek-v4-flash`)。这个 demo 通过 `AGENT_MODEL` 环境变量配置,默认 `deepseek-v4-flash`。
- 遥测:SDK 本身不产生 OTel 数据,只是把 env 透传给 CLI 子进程;CLI 有自己的 OTel 三信号开关,traces
  还在 beta 且默认内容脱敏。这个 demo 没有接观测,纯粹是一个能跑的 agent。

## 运行时依赖

- 需要 `ANTHROPIC_API_KEY`;`query()` 会把它(以及 `ANTHROPIC_BASE_URL`,如果设置了的话)透传给
  Claude Code CLI 子进程。默认走官方 Anthropic API;也可以指向任何 Anthropic 兼容端点——本仓库
  已用 DeepSeek 的 `https://api.deepseek.com/anthropic` + `deepseek-v4-flash` 端到端验证过:
  天气/算术工具调用、多轮 `resume` 会话续接均正常。
- SDK 把 `claude-code` 原生可执行文件作为 optional dependency 一起装;如果你的包管理器跳过了
  optional deps,需要额外装 `@anthropic-ai/claude-code` 并设置
  `options.pathToClaudeCodeExecutable` 指向那个可执行文件。

## 跑起来

这个目录是一个**独立的 npm 项目**(自带 `package.json` + `pnpm-workspace.yaml`)。

```sh
cd examples/zh/origin/claude-agent-sdk
pnpm install
cp .env.example .env
# 编辑 .env,填入 ANTHROPIC_API_KEY(以及可选的 ANTHROPIC_BASE_URL / AGENT_MODEL)

pnpm dev
# 另开一个终端冒烟:
curl localhost:5189/healthz
curl -X POST localhost:5189/api/chat -H 'content-type: application/json' \
  -d '{"message":"北京天气怎么样"}'
```

浏览器打开 `http://localhost:5189/` 就是聊天界面。
