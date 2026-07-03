# ai-sdk-v7 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/ai-sdk-v7`](../../origin/ai-sdk-v7/) 的**逐字节副本**（除
`package.json` / `pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与
origin 完全一致，见 [`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的
三条铁律）+ 新增的 niceeval 接入代码：`agents/`、`evals/`、`experiments/`、
`niceeval.config.ts`。

**这不是仓库里已有的 `examples/zh/ai-sdk-v7`**（那个用内建 `aiSdkAgent` 进程内直调，是另一种
Tier 1 接入路数）。本目录做的是**对着 HTTP 接口的黑盒接入**——adapter 只会 `fetch()`
`../src/backend/server.ts` 暴露的 `/api/chat`，不 import 任何应用代码。

ai-sdk-v7 应用本身（`src/backend/`）**一行没改**——服务端零状态，每轮请求体都要带上完整的
`UIMessage[]`（AI SDK v7 的"客户端带全量历史"模式，五个应用里唯一一个）。

## 这是 Tier 1（无侵入）

adapter 只是把这个已有的 HTTP + SSE 服务当黑盒接进 niceeval，不改被测应用一行代码。Tier 2
（把 system prompt / 工具集提升为环境变量，解锁完整 feature A/B test）不在本次范围内。

## 目录

- `agents/server-lifecycle.ts`：把 `src/backend/server.ts` 当子进程管起来。**不用按 model
  分桶**——和其它四个示例不同，model 走请求体（`ai-sdk-runtime.ts` 的 `resolveModel` 每次请求
  都重新解析），一个共享进程能服务所有 model，`experiments/compare-models/` 的多个实验组
  复用同一个服务。
- `agents/ai-sdk-v7.ts`：adapter 本体。事件来源是
  `events: otelEvents({ dialects: [otel.genAi] })`——应用用官方 `@ai-sdk/otel` 集成，产标准
  GenAI semconv span，`get_weather` 这类无审批门的工具断言 / 消息 / usage / 瀑布图全从 span
  派生。SSE 只用来做两件 span 管不到的事：
  1. **重建 assistant 消息本身，喂回下一轮请求体**——用 `ai` 包导出的框架无关 reducer
     `readUIMessageStream`（`useChat` 内部用的就是它）把裸 chunk 流归约成逐步完整的
     `UIMessage` 快照，不用自己手写状态机；
  2. **识别 HITL 停在哪**（tool 类型 part 进入 `"approval-requested"` 状态）。

  **`calculate`（`needsApproval: true`）的 `action.called`/`action.result` 是手动补的**：
  实测发现 `@ai-sdk/otel` 不给审批-恢复这条路径产 `execute_tool` 类型 span（`get_weather` 这类
  普通工具完全正常），deny 的调用更彻底——从来不会真的执行，SSE 里连 `tool-output-*` 帧都
  没有。详见 `memory/ai-sdk-otel-needsapproval-no-execute-tool-span.md`。
- `evals/`：基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/assistant.ts`：单配置基线。`experiments/compare-models/`：deepseek-v4-flash /
  deepseek-v4-pro 两个模型对比。

## 声明的能力位

- `conversation: true`——已验证：`isNew` 时生成新 `sessionId`、非 `isNew` 时按 `sessionId`
  找回完整历史并原样重发（服务端零状态，续接完全靠客户端重放）。
- `toolObservability: true`——已验证：`get_weather` 每次调用都从 span 派生完整的
  `action.called`/`action.result`；`calculate`（gated）由 adapter 手动补，同样无遗漏（见上）。
- `tracing`（proven by 声明了 `tracing` 块 + `events: otelEvents()`，不用重复写
  `capabilities.tracing`）——`tracing.env` 给 base（去掉 `/v1/traces` 尾巴，
  `OTLPTraceExporter()` 自己拼），`scope: "run"`（长驻共享服务，不像其它四个按 model 分桶）。
  额外注入 `OTEL_BSP_SCHEDULE_DELAY`，配合 `send()` 收尾的 flush grace，解决
  `BatchSpanProcessor` 调度延迟和"轮次几时结束"两条时间线对不齐的问题（同
  `memory/langsmith-dialect-langchain-completion-shape-gap.md` 记录的 langgraph 那次）。

## HITL

`calculate` 工具声明了 `needsApproval: true`（AI SDK 自己的 tool loop 停轮机制）。**没有
approve 端点**——批准/拒绝的决定是把上一条（还停在 `approval-requested` 状态的）assistant
消息原地改成 `approval-responded`，原样重发整个 `messages` 数组触发服务端续跑，和真实前端
`addToolApprovalResponse` + 自动重发的效果完全一致，这里手动做同样的事。`approval.id` **不是**
`toolCallId`，是流里单独发的 `approvalId`（`tool-approval-request` chunk 里的字段，打帧确认
过）。

## 跑起来

```sh
cd examples/zh/tier1/ai-sdk-v7
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY / DEEPSEEK_API_KEY
pnpm exec niceeval list
pnpm exec niceeval exp assistant
pnpm exec niceeval exp compare-models
pnpm exec niceeval view
```

不需要单独起前端或后端进程——`niceeval exp` 第一次 `send` 时会自动 spawn
`src/backend/server.ts`（一个共享实例，所有 model 都打它），跑完这次 CLI 进程退出时一并杀掉。
