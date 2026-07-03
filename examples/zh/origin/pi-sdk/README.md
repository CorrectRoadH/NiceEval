# pi-sdk example

演示怎么用 **pi SDK**(`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`，
https://github.com/earendil-works/pi)搭一个真实的 tool-calling agent 后端，接一个
共享的 React 聊天前端。**独立项目，不接 niceeval**——不 import `niceeval`，没有
`adapter/`、`evals/`、`niceeval.config.ts`，是给 `README.md` / `README.zh.md`
"Agent Frameworks" roadmap 配的示例/文档素材，和 `examples/zh/origin/claude-agent-sdk`、
`examples/zh/origin/codex-sdk` 是同一批：真实 SDK、真实模型调用、真实工具调用，不是
niceeval 集成教程。

这个目录之前演示的是"不用任何 agent 框架，手写 OpenAI tool-calling 循环 + 手写 OTel
GenAI 语义约定埋点"。那条路径已经被判定没有持续价值，整体重写成一个真的用 agent SDK
搭出来的应用——不再有 `tracing.ts`、`docker-compose.yml`(Jaeger)这些 OTel 相关的东西。

## 为什么是 pi

pi(`@earendil-works/pi-agent-core` 的 `Agent` 类)是一个通用 agent 运行时：注册任意
`AgentTool`(typebox 参数 schema + `execute`)、拿到逐 token 的流式事件
(`AgentEvent` / `AssistantMessageEvent`)、用 `beforeToolCall` 在工具真正执行前挂
钩子(这个示例拿它做 HITL 审批，见下文)。模型层用 `@earendil-works/pi-ai`：
`createModels()` + `deepseekProvider()` 给出一个 DeepSeek 的 `Models` 实例，鉴权自动
从 `DEEPSEEK_API_KEY` 读(`envApiKeyAuth`，代码里不用手动传 key)。

和被替换掉的旧版一样，`agent.ts` 的 `createAgent()` 每次 `/api/chat` 请求都 new 一个
全新 `Agent`——**无状态、单轮**，不维护跨请求的历史(旧版 `runAgent(message)` 也是每次
从零拼 `messages` 数组，这不是这次重写引入的退步)。

## 前后端接口：把 pi 的 AgentEvent 流翻译成 AI SDK 的 UI Message Stream 协议

这个示例接的是和 `examples/zh/origin/ai-sdk-v7` 同一套 React 聊天前端(`@ai-sdk/react`
的 `useChat` + `DefaultChatTransport`)。`UIMessageChunk`
(`node_modules/ai/dist/index.d.ts` 里的 `type UIMessageChunk`)是协议层类型——任何
后端手写这些 chunk 都行，不一定要经过 AI SDK 自己的 `streamText`。这里模型调用完全由
pi 驱动，所以用 `createUIMessageStream({ execute })` 手写翻译，而不是套
`toUIMessageStream`(那是从 `streamText` 的结果转换，这里没有那个结果)。

`server.ts` 的 `streamChat()` 订阅 `agent.subscribe()`，按事件类型翻译：

- `message_update` 的 `assistantMessageEvent`(`text_start` / `text_delta` /
  `text_end`)→ 逐 token 的 `text-start` / `text-delta` / `text-end`——这是真正
  的 token 级流式，不是攒完整句再吐。`contentIndex` 每个 turn 都从 0 重新数，拼上
  turn 序号(`t${turnIndex}-${contentIndex}`)当 chunk id，避免多轮文本 id 撞车。
- `tool_execution_start` → `tool-input-available`(`toolCallId`/`toolName`/`input`)。
- `tool_execution_end` → `tool-output-available`(正常)/ `tool-output-error`
  (`isError`)/ `tool-output-denied`(被 HITL 拒绝，见下文)。

## Human-in-the-loop：calculate 工具的审批

`calculate` 工具挂了审批，`get_weather` 不挂——和这批示例里其它项目的 HITL 演示对齐。
审批状态是**进程内的一个 `Map`**，不是 AI SDK 原生的 `tool-approval-response` 协议：

- `server.ts` 里 `const pendingApprovals = new Map<string, (approved: boolean) => void>()`。
- `createAgent()` 传的 `beforeToolCall`：命中 `calculate` 时，先给当前这条(还开着的)
  SSE 流写一个 `tool-approval-request` chunk，再
  `await new Promise<boolean>(resolve => pendingApprovals.set(toolCall.id, resolve))`
  卡住 pi 的 tool 执行。批准返回 `undefined`(放行)，拒绝返回
  `{ block: true, reason: '用户拒绝了这次调用' }`(pi 自己会产出一条错误的 tool
  result，`tool_execution_end` 照样会到达，`server.ts` 用 `deniedToolCalls` 这个
  `Set` 区分"被拒绝"和"真的执行报错")。
- `POST /api/chat/approve`，body 是 `{ toolUseId, approved }`：查
  `pendingApprovals` 拿到 `resolve`，调用它，原来那条 `/api/chat` 请求的 SSE 流才会
  继续往下走。
- 前端(`src/client/App.tsx`)点"允许"/"拒绝"直接 `fetch('/api/chat/approve', ...)`，
  **不用** `useChat` 的 `addToolApprovalResponse` / `sendAutomaticallyWhen`——那一套是
  给"审批决定要重新塞进下一条请求消息、由 AI SDK 自己续上 tool loop"的协议设计的；这里
  连接全程保持打开，服务端直接在原地继续，不需要客户端重新发起请求。

## 目录结构

- `tools.ts`：两个工具的真实实现——`getWeather(city)`(mock 数据，不打真实天气
  API)、`calculate(expression)`(白名单正则 + `Function` 的安全算术求值)，包成 pi
  的 `AgentTool`(`Type.Object(...)` typebox 参数 schema，从
  `@earendil-works/pi-ai` 重新导出，不是 zod；`execute(toolCallId, params)` 签名）。
- `agent.ts`：`createModels()` + `deepseekProvider()` 建模型，`createAgent()` 每次
  请求 new 一个 `Agent`(系统提示词 + 两个工具 + `streamFn: models.streamSimple.bind(models)`),
  `beforeToolCall` 由调用方(`server.ts`)传入。
- `server.ts`：`node:http` 服务器，负责 HTTP 路由和"pi `AgentEvent` →
  `UIMessageChunk`"的协议翻译(见上文)。
  - `GET /healthz` → `{ok:true}`
  - `POST /api/chat`,body 是 `{ message: string }` → AI SDK 的 UI Message Stream
    (SSE)，一路开着直到这轮回复结束或客户端断开(`req.on('close')` 会 `agent.abort()`)。
  - `POST /api/chat/approve`，body 是 `{ toolUseId: string, approved: boolean }`。
- `src/client/App.tsx` / `App.css` / 根 `index.html` / `vite.config.ts`：和
  `ai-sdk-v7` 同款的 React 聊天 UI(`useChat` + `DefaultChatTransport`)，去掉了模型
  选择器和图片上传(这个示例用不到)，保留工具气泡和审批气泡。
  `DefaultChatTransport` 默认会把整份 `UIMessage[]` 历史发给服务端；这里后端是无状态
  单轮 agent，所以用 `prepareSendMessagesRequest` 把请求体换成只含这一轮用户文本的
  `{ message }`。`vite.config.ts` 把 `/api` 代理到 `server.ts` 监听的 5299 端口。
- `.env.example` / `.gitignore` / `tsconfig.json` / `package.json`：独立项目配置，
  不属于仓库根 pnpm workspace(自带空 `pnpm-workspace.yaml`)。

## 跑起来

这个目录是一个**独立项目**(自带 `package.json`，不是仓库根 workspace 成员)。

```sh
cd examples/zh/origin/pi-sdk
pnpm install
cp .env.example .env
# 编辑 .env: DEEPSEEK_API_KEY=sk-...(可选 AGENT_MODEL,默认 deepseek-v4-flash)

pnpm dev
# 浏览器打开 http://localhost:5300(Vite 把 /api 代理到 5299 上的 server.ts),
# 或者直接看后端吐出的 UI Message Stream:
curl -N -X POST localhost:5299/api/chat -H 'content-type: application/json' \
  -d '{"message":"北京天气怎么样"}'

# HITL:问一个需要 calculate 的问题,流会在 tool-approval-request 那一帧停住,
# 另开一个终端用 toolCallId 批准/拒绝:
curl -X POST localhost:5299/api/chat/approve -H 'content-type: application/json' \
  -d '{"toolUseId":"call_...","approved":true}'
```

`pnpm typecheck` 跑 `tsc --noEmit`。
