# Codex SDK example

演示怎么用 OpenAI 的 **Codex TypeScript SDK**(`@openai/codex-sdk`)搭一个 agent
后端(HTTP 服务器 + 一个极简聊天页面)。**独立项目,不接 niceeval**——不 import
`niceeval`,没有 `adapter/`、`evals/`、`niceeval.config.ts`,是给
`README.md` / `README.zh.md` "Agent Frameworks" roadmap 里 "Codex SDK" 这一项
配的示例/文档素材,不是一个可用的 niceeval 集成。

## Codex SDK 是什么样的 SDK(为什么任务形状长这样)

Codex SDK 包的是 `codex` CLI 本身:`new Codex()` 起一个客户端,
`codex.startThread({ workingDirectory })` 开一条对话线程,
`thread.run(message)` 跑一轮——SDK 内部 spawn `codex` CLI 子进程、用 JSONL 协议
交换事件。它是**"目录里的编码 agent"**:内置文件读写、跑 shell 命令、
git 感知,不是一个"你注册任意自定义 tool(比如 `get_weather`)、它帮你调"的
通用 chat SDK。

所以这个示例的聊天框发的是**自然语言编码请求**("创建一个文件叫
notes.txt"、"列出这个目录下的文件"),而不是硬凑一个天气/计算器工具——那样
会掩盖 Codex 真正的能力形状。

## 前后端接口:SDK 的事件流就是协议

SDK 自己推荐的用法是 `thread.runStreamed()`:返回 `ThreadEvent` 的
AsyncGenerator(`thread.started` / `turn.started` / `item.started|updated|completed` /
`turn.completed` / `turn.failed` / `error`),官方示例
(`sdk/typescript/samples/basic_streaming.ts`)就是拿这个事件循环驱动 UI 的。
所以这里不发明 `{reply, toolCalls}` 之类的中间格式:后端把每个 `ThreadEvent`
原样编成一帧 SSE 转发,前端按 `event.type` / `item.type` 渲染——
`agent_message` 是助手回复,`command_execution` / `file_change` /
`mcp_tool_call` / `web_search` / `todo_list` 按事件到达实时更新(`item.started`
先挂进行中占位,`item.updated` / `item.completed` 按 `item.id` 原地刷新)。

## 目录结构

- `agent.ts`:Codex 客户端构造(`new Codex({ apiKey, baseUrl })`)、
  `WORKSPACE_DIR`、真调用 Codex SDK 的 `runTurnStreamed()`——
  start/resume thread 之后把 `runStreamed()` 的事件流原样交给 server.ts。
- `server.ts`:一个 `node:http` 服务器,没有任何框架依赖,只管 HTTP 路由和
  SSE 编帧,真正的 Codex 调用委托给 `agent.ts`。
  - `GET /healthz` → `{ok:true}`
  - `GET /` → 返回 `public/index.html`
  - `POST /api/chat`,body `{message, threadId?}` → `text/event-stream`,
    每帧 `data:` 是一个原样的 `ThreadEvent` JSON——真调用 Codex SDK,在
    `workspace/`(gitignored 的 scratch 目录)里跑,没有 mock 模式。浏览器
    断开时经 `TurnOptions.signal` 取消这一轮 turn。
- `public/index.html`:单文件静态前端——一个输入框 + 发送按钮 + 消息/事件
  日志,内联 `<style>`/`<script>`,`fetch()` 读 SSE 流(EventSource 只支持
  GET,所以手动按空行切帧),没有 Vite/React/构建步骤。
- `.env.example` / `.gitignore` / `tsconfig.json` / `package.json`:独立项目
  配置,不属于仓库根 pnpm workspace(自带空 `pnpm-workspace.yaml`)。

## 运行时要求(实测记录)

- `pnpm add @openai/codex-sdk` 会把 `@openai/codex`(即 `codex` CLI 本体,
  含平台二进制)当作依赖一起装下来——**不需要额外全局装 CLI**,`pnpm install`
  就够了(前提是有该平台的预编译包)。
- 需要 `CODEX_API_KEY`(直接传给 `new Codex({ apiKey, baseUrl })`,SDK 内部
  原样写进子进程的 `env.CODEX_API_KEY`,不经过 `OPENAI_API_KEY` 中转)。
  `CodexOptions` 的 `baseUrl` 会映射成 CLI 的 `--config
  openai_base_url=...`,可以指向自建的 OpenAI 兼容代理;`ThreadOptions` 的
  `model` 字段控制模型,默认 `AGENT_MODEL=gpt-5.4`。见
  `node_modules/@openai/codex-sdk/dist/index.js` 里 `CodexExec.run()` 的实现。
- 会话续接用 Codex 原生机制:第一轮 `codex.startThread()`,`thread.started`
  事件带出 `thread_id`,由**前端**保存、下一轮随请求带回,服务端用
  `codex.resumeThread(threadId)` 接回去——服务端零会话状态,也不用自己攒
  对话历史。Codex 自己把 thread 落盘在 `~/.codex/sessions`。
- 来源:`node_modules/@openai/codex-sdk/README.md`(装完包后自带,内容与
  https://github.com/openai/codex/blob/main/sdk/typescript/README.md 一致)、
  `node_modules/@openai/codex-sdk/dist/index.d.ts`(`ThreadItem` / `Turn` /
  `ThreadOptions` / `CodexOptions` 的真实类型定义)。

## 跑起来

这个目录是一个**独立项目**(自带 `package.json`,不是仓库根 workspace 成员)。

```sh
cd examples/zh/origin/codex-sdk
pnpm install
cp .env.example .env
# 编辑 .env: CODEX_API_KEY=sk-...(可选 CODEX_BASE_URL、AGENT_MODEL)

pnpm dev
# 浏览器打开 http://localhost:5199,或直接看 SSE 事件流:
curl -N -X POST localhost:5199/api/chat -H 'content-type: application/json' \
  -d '{"message":"创建一个文件"}'
```

`pnpm typecheck` 跑 `tsc --noEmit`。
