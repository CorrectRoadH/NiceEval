# pi-sdk 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/pi-sdk`](../../origin/pi-sdk/) 的**逐字节副本**（除 `package.json` /
`pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与 origin 完全一致，见
[`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的三条铁律）+ 新增的 niceeval
接入代码：`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`。

pi-sdk 应用本身（`src/backend/`）**一行没改**——真实 agent 是
[`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) 的
`Agent`，走 DeepSeek，服务端把 `agent.subscribe()` 收到的原生 `AgentEvent` 原样透传成 SSE。

## 这是 Tier 1（无侵入）

adapter 只是把这个已有的 HTTP + SSE 服务当黑盒接进 niceeval，不改被测应用一行代码。Tier 2（把
system prompt / 工具集提升为可配置项,解锁完整 feature A/B test）不在本次范围内。

## 目录

- `agents/server-lifecycle.ts`：把 `src/backend/server.ts` 当子进程管起来——按 model 分桶（pi 的模型
  只能在进程启动时读 `AGENT_MODEL` 一次,不支持按请求切换),每桶各挑一个空闲端口、轮询 `/healthz`
  直到就绪。跑 eval 前**不需要**手动 `pnpm dev`,第一次 `send` 会自动拉起。
- `agents/pi-sdk.ts`：adapter 本体。手写 SSE 帧映射(pi 无 OTel,官方方言帮不上,见形态矩阵
  D 档)——原生 `AgentEvent`(`message_end` / `tool_execution_start` / `tool_execution_end`)+ 三种
  传输层帧(`session` / `approval_request` / `server_error`)翻成标准 `StreamEvent[]`。
- `evals/`：基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/assistant.ts`：单配置基线。`experiments/compare-models/`：deepseek-v4-flash /
  deepseek-v4-pro 两个模型对比,一文件一模型。

## 声明的能力位

- `conversation: true`——已验证:`isNew` 时不带 `sessionId` 开新会话、服务端回传的 `sessionId`
  写回 `ctx.session.id`、非 `isNew` 时带 id 续接同一条服务端内存历史(`sessions` Map)。
- `toolObservability: true`——已验证:`get_weather` / `calculate` 每次调用都有配对的
  `tool_execution_start` / `tool_execution_end`,无遗漏。
- **不声明 `tracing`**:pi-agent-core / pi-ai 没有官方 OTel 集成,这是形态矩阵里唯一"完全没有
  OTel"的应用(D 档)。`niceeval view` 这个应用没有调用瀑布图——这不是接入疏漏,是应用侧现状。

## HITL

`calculate` 工具经服务端 `beforeToolCall` 挂了审批(见 `src/backend/server.ts` 头注释)。approval
frame 到达时 SSE 流不关闭——服务端把执行卡在一个 Promise 上,等 `POST /api/chat/approve`。adapter
把"读了一半的流"存进模块级 `Map<sessionId, …>`,下一次 `t.respond("approve"/"deny")` 打 approve
端点后**继续读同一条流**到结束,不重新发 `/api/chat`。批准字段名是 `toolUseId`(不是
`toolCallId`——这是 `/api/chat/approve` 请求体的字段名,和帧里的 `toolCallId` 不是一回事)。

## 跑起来

```sh
cd examples/zh/tier1/pi-sdk
pnpm install
cp .env.example .env   # 填 DEEPSEEK_API_KEY
pnpm exec niceeval list
pnpm exec niceeval exp assistant
pnpm exec niceeval exp compare-models
pnpm exec niceeval view
```

不需要单独起 web 前端或后端进程——`niceeval exp` 第一次 `send` 时会自动 spawn `src/backend/server.ts`
(每个 model 一个实例),跑完这次 CLI 进程退出时一并杀掉。
