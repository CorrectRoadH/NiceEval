# claude-sdk 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/claude-sdk`](../../origin/claude-sdk/) 的**逐字节副本**（除 `package.json` /
`pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与 origin 完全一致，见
[`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的三条铁律）+ 新增的 niceeval
接入代码：`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`。

claude-sdk 应用本身（`src/backend/`）**一行没改**——真实 agent 是
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) 的
`query()`,服务端把原生 `SDKMessage` 流原样透传成 SSE。

## 这是 Tier 1（无侵入）

adapter 只是把这个已有的 HTTP + SSE 服务当黑盒接进 niceeval,不改被测应用一行代码。Tier 2(把
`allowedTools` / system prompt 提升为环境变量,解锁完整 feature A/B test)不在本次范围内。

## 目录

- `agents/server-lifecycle.ts`:把 `src/backend/server.ts` 当子进程管起来——按 model 分桶
  (`agent.ts` 里的 `MODEL` 只在模块加载时读一次 `AGENT_MODEL`,不支持按请求切换),每桶各挑一个
  空闲端口、轮询 `/healthz` 直到就绪。跑 eval 前**不需要**手动 `pnpm dev`。
- `agents/claude-sdk.ts`:adapter 本体。手写 SSE 帧映射(claude-code CLI 原生遥测只有
  metrics+logs,niceeval 不消费,不声明 `tracing`)——原生 `SDKMessage`(`system`/`assistant`/
  `user`/`result`)翻成标准 `StreamEvent[]`。`stream_event`(逐 token 渲染用)整个忽略。
- `evals/`:基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/assistant.ts`:单配置基线。`experiments/compare-models/`:deepseek-v4-flash /
  deepseek-v4-pro 两个模型对比(通过 DeepSeek 的 Anthropic 兼容端点,见 `.env.example`)。

## 声明的能力位

- `conversation: true`——已验证:`isNew` 时不带 `sessionId` 开新会话、`system`/`init` 帧回传的
  `session_id` 写回 `ctx.session.id`、非 `isNew` 时带 id 经 SDK 的 `resume` 续接同一条历史
  (SDK 落盘在 `~/.claude/projects/`)。
- `toolObservability: true`——已验证:`get_weather` / `calculate` 每次调用都有配对的
  `tool_use` → `action.called`、`tool_result`(或拒绝时的 `system`/`permission_denied`)→
  `action.result`,无遗漏。
- **不声明 `tracing`**:claude-code CLI 原生遥测(`CLAUDE_CODE_ENABLE_TELEMETRY=1`)只导出
  metrics + logs,没有 trace spans——niceeval 只消费 trace spans,这个应用在形态矩阵里是
  "只有 metrics+logs"档。`niceeval view` 这个应用没有调用瀑布图——这不是接入疏漏,是应用侧现状。

## HITL

`calculate` 工具经 `query()` 的 `canUseTool` 挂了审批(见 `src/backend/agent.ts` 头注释)。这里
**没有显式的"等审批"帧**——`canUseTool` 把 SDK 内部执行卡在一个 Promise 上,SSE 流本身不产出
新消息。adapter 见到 gated 工具(`mcp__demo-tools__calculate`,MCP 命名空间下的真实工具名,不是
裸的 `calculate`)的 `tool_use` 块就直接判定"停在审批上",把"读了一半的流"存进模块级
`Map<sessionId, …>`,下一次 `t.respond("approve"/"deny")` 打 `/api/chat/approve` 端点
(字段名 `toolUseId`)后**继续读同一条流**到结束。拒绝时 SDK 发 `system`/`permission_denied`
帧(带 `tool_use_id`),映射成 `status: "rejected"`。

提示词工程踩坑记录:提示词里明说"这个要经过审批"会让某些模型倾向于用自然语言反问用户
"可以吗?",而不是真的发起工具调用(在 pi-sdk 的接入里复现过同样的行为,已同步改成不提审批
的自然问法);审批门本来就是服务端自动挂的,跟用户怎么问无关。

## 跑起来

```sh
cd examples/zh/tier1/claude-sdk
pnpm install
cp .env.example .env   # 填 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
pnpm exec niceeval list
pnpm exec niceeval exp assistant
pnpm exec niceeval exp compare-models
pnpm exec niceeval view
```

不需要单独起前端或后端进程——`niceeval exp` 第一次 `send` 时会自动 spawn `src/backend/server.ts`
(每个 model 一个实例),跑完这次 CLI 进程退出时一并杀掉。
