# ai-sdk-v7 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/ai-sdk-v7`](../../origin/ai-sdk-v7/) 的**逐字节副本**（除
`package.json` / `pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与
origin 完全一致，见 [`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的
三条铁律）+ 新增的 niceeval 接入代码：`agents/`、`evals/`、`experiments/`、
`niceeval.config.ts`。

本目录做的是**对着 HTTP 接口的无侵入接入**——adapter 只会 `fetch()`
`../src/backend/server.ts` 暴露的 `/api/chat`，不 import 任何应用代码。

ai-sdk-v7 应用本身（`src/backend/`）**一行没改**——服务端零状态，每轮请求体都要带上完整的
`UIMessage[]`（AI SDK v7 的"客户端带全量历史"模式，五个应用里唯一一个）。

## 这是 Tier 1（无侵入）

adapter 只是把这个已有的 HTTP + SSE 服务无侵入接进 niceeval，不改被测应用一行代码。Tier 2
（把 system prompt / 工具集提升为环境变量，解锁完整 feature A/B test）不在本次范围内。

## 目录

- `agents/ai-sdk-v7.ts`：adapter 本体——就是一个**内置 `uiMessageStreamAgent` 的配置调用**
  （UI Message Stream 协议的官方无侵入 adapter,`"niceeval/adapter"` 导出）。SSE 归约
  （官方 reducer `readUIMessageStream`）、"客户端带全量历史"的会话重放、HITL 审批 part
  改写重发、工具/消息事件从协议帧直构,全部是工厂内置行为;这里只声明端点在哪、
  请求体怎么带 `model`、span 收尾宽限(`settleMs`,只影响瀑布图)。
  协议帧里没有 usage,所以这个示例没有用量断言;OTel(应用官方 `@ai-sdk/otel` 集成)只服务
  `niceeval view` 的瀑布图,span 不喂断言。（`@ai-sdk/otel` 对 `needsApproval` 工具的审批链
  路不产 `execute_tool` span 的 gap 见 `memory/ai-sdk-otel-needsapproval-no-execute-tool-span.md`
  ——断言不依赖 span,该 gap 只让瀑布图少一条 span。）
- `evals/`：基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/assistant.ts`：单配置基线。`experiments/compare-models/`：deepseek-v4-flash /
  deepseek-v4-pro 两个模型对比。

## 能力从哪来

新契约下没有能力声明这件事——agent 工厂 option 里已经没有 `capabilities` 字段，`t` 上解锁
什么完全看 adapter 实际接了什么、返回过什么，不是写一个标志位。这个示例（内置
`uiMessageStreamAgent`）能验证到：

- 跨轮记忆 + `newSession()` 隔离：已验证——新会话线（首轮）生成新 `sessionId`、之后按
  `sessionId` 找回完整历史并原样重发（服务端零状态，续接完全靠客户端重放）；会话续接的存
  取器是工厂内置行为，agent 配置里不用多写一行。
- 工具事件全量可信（`t.calledTool()` / `t.notCalledTool()` 等负断言可用）：`get_weather` /
  `calculate`（含审批批准/拒绝两条分支）每次调用的 `action.called`/`action.result` 都从协议
  帧直构，无遗漏——这份完整性证明随工厂返回值走，不用声明。
- trace 瀑布图：`niceeval.config.ts` 配了 `telemetry: { port }` 固定端口就有——应用官方
  `@ai-sdk/otel` 集成产的 GenAI spans 发过来,只进 `niceeval view` 的瀑布图,不喂断言。
  应用用 `BatchSpanProcessor`,配合工厂的 `settleMs` 收尾宽限和启动时的
  `OTEL_BSP_SCHEDULE_DELAY=200`（见「跑起来」）,解决调度延迟和"轮次几时结束"两条时间线
  对不齐的问题——对不齐时也只是瀑布图缺尾巴。协议帧里没有 usage,这个示例没有用量断言。

## HITL

`calculate` 工具声明了 `needsApproval: true`（AI SDK 自己的 tool loop 停轮机制）。**没有
approve 端点**——批准/拒绝的决定是把上一条（还停在 `approval-requested` 状态的）assistant
消息原地改成 `approval-responded`，原样重发整个 `messages` 数组触发服务端续跑，和真实前端
`addToolApprovalResponse` + 自动重发的效果完全一致——这套握手现在整个是
`uiMessageStreamAgent` 的内置行为（拒绝时默认带"不要重试"的 reason,可用 `denyReason`
覆盖）。`approval.id` **不是** `toolCallId`，是流里单独发的 `approvalId`
（`tool-approval-request` chunk 里的字段，打帧确认过）。

## 跑起来

被测应用由你自己按它的方式启动,eval 不代管进程、不另开端口。model 走请求体
(`ai-sdk-runtime.ts` 的 `resolveModel` 每次请求都重新解析),一个实例服务所有 model,
`compare-models` 的多个实验组打同一个服务。

```sh
cd examples/zh/tier1/ai-sdk-v7
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY / DEEPSEEK_API_KEY

# 终端 1:起应用(要瀑布图/usage 就把 OTel 指到 niceeval 的固定接收端口,标准 OTLP 4318;
# 本机 4318 被占时,两边一起换:应用改这里的端口,eval 侧改 niceeval.config.ts 的 telemetry.port)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_BSP_SCHEDULE_DELAY=200 pnpm run dev:server

# 终端 2:跑 eval(应用部署在别处时设 AI_SDK_V7_URL 指过去)
pnpm exec niceeval exp assistant
pnpm exec niceeval exp compare-models
pnpm exec niceeval view
```
