# Claude Agent SDK 示例

这是一个**独立示例应用**,演示用 [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
(把 Claude Code CLI 包成子进程的 harness SDK,`query()` 返回 `SDKMessage` 流——**不是**普通
Messages API 的 `@anthropic-ai/sdk`)搭一个带工具调用的 agent 后端长什么样。

这个目录不依赖、不 import `niceeval`,没有 `adapter/`、`evals/`、`niceeval.config.ts`——它只是
仓库根 README「Agent Frameworks」路线图里 “Claude SDK” 一项配的文档/示例素材,**不是**一个可用的
niceeval 接入实现。

每次对话都是真实的 `query()` 调用——没有 mock 模式、没有离线开关。两个工具(`get_weather` /
`calculate`)背后是确定性模拟数据,那只是"假天气",跟"是否真的调用了模型"是两回事。

## 目录结构

- `src/backend/tools.ts`:两个工具的纯逻辑实现(`WEATHER_TABLE`/`getWeather`/`calculate`,确定性模拟数据,
  `calculate` 是自写的小型递归下降算术求值器,不用 `eval`/`Function`),以及把它们包成
  Claude Agent SDK `tool()` 形状的 `buildTools(log)`。
- `src/backend/agent.ts`:`SYSTEM_PROMPT`、`MODEL`,以及真实调用 `query()` 的 `runTurn(message, sessionId)`。
  多轮会话靠上一轮 `result` 消息里的 `session_id`(存在 `claudeSessionIdByOurSession`),通过
  `options.resume` 续接同一个 Claude Code 会话历史。
- `src/backend/server.ts`:HTTP 层,一个 `node:http` 服务器(无框架)。
  - `GET /healthz` → `{ok:true}`
  - `POST /api/chat`,body `{message, sessionId?}` → `{reply, toolCalls, sessionId}`,内部调
    `agent.ts` 的 `runTurn`。
  - `GET /` → 返回 `src/frontend/index.html`
- `src/frontend/index.html`:单文件前端,inline `<style>`/`<script>`,`fetch()` 调 `/api/chat`,没有
  构建步骤、没有流式渲染、没有框架。
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
cd examples/zh/origin/claude-sdk
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
