# codex-sdk 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/codex-sdk`](../../origin/codex-sdk/) 的**逐字节副本**（除 `package.json` /
`pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与 origin 完全一致，见
[`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的三条铁律）+ 新增的 niceeval
接入代码：`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`。

codex-sdk 应用本身（`src/backend/`）**一行没改**——真实 agent 是
[`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) 的 `thread.runStreamed()`，
服务端把原生 `ThreadEvent` 流原样透传成 SSE。它是**编码 agent**：有一个固定的 scratch 工作目录
`workspace/`（运行时生成，不清空），eval 测的是真实的"在目录里写文件、跑命令"，不是纯聊天。

## 这是 Tier 1（无侵入）

adapter 只是把这个已有的 HTTP + SSE 服务当黑盒接进 niceeval，不改被测应用一行代码。Tier 2（把
`threadOptions`——sandbox mode 等——提升为环境变量，解锁完整 feature A/B test）不在本次范围内。

## 目录

- `agents/server-lifecycle.ts`：把 `src/backend/server.ts` 当子进程管起来——按 model 分桶（codex
  客户端在模块加载时构造一次，`AGENT_MODEL` / `OTEL_EXPORTER_OTLP_ENDPOINT` 都是启动时读一次的
  环境变量，不支持按请求切换）。跑 eval 前**不需要**手动 `pnpm dev`。
- `agents/codex-sdk.ts`：adapter 本体。手写 SSE 帧映射——`ThreadEvent`
  （`thread.started` / `item.started` / `item.completed` / `turn.completed` / `turn.failed`）翻成
  标准 `StreamEvent[]`。**没有 HITL**（Codex SDK 不支持），永不返回 `waiting`。
- `evals/`：基础问答、创建文件（用 `node:fs` 直接核实磁盘上的真实内容，不只信模型自述）、跑
  shell 命令、跨轮记忆 + `newSession()` 隔离（用口头偏好而不是文件是否存在做隔离信号，见
  `session-isolation.eval.ts` 注释——`workspace/` 是所有 thread 共享的同一份磁盘状态）。
- `experiments/codex-sdk.ts`：单配置基线。这个应用只有一个可用模型档位，没有
  `experiments/compare-models/`（`docs/origin-integration.md` 的验收清单里多模型对比只点名了
  ai-sdk-v7 / claude-sdk / pi-sdk）。

## 声明的能力位

- `conversation: true`——已验证：`isNew` 时不带 `threadId` 开新会话、`thread.started` 帧回传的
  `thread_id` 写回 `ctx.session.id`、非 `isNew` 时带 id 经 `codex.resumeThread` 续接同一条历史
  （SDK 落盘在 `~/.codex/sessions`）。
- `toolObservability: true`——已验证：`command_execution` / `file_change` / `mcp_tool_call` /
  `web_search` 每次调用都有配对的 `item.started` → `action.called`、`item.completed` →
  `action.result`，无遗漏。
- `tracing: true` + `tracing: { scope: "run", env }`——codex CLI 原生 `otel` 配置段导出 trace
  spans，长驻服务必须 `scope: "run"`（整个 run 共享一个接收器，默认 per-attempt 端口会在第一个
  attempt 结束后失效）；`env` 剥掉 `/v1/traces` 尾巴，codex 自己在配置里拼。

  **没有声明 `spanMapper`**：codex 的 span 是自家命名（无标准 GenAI 属性、无工具 I/O），本该用
  内置的 `mapCodexSpans`（`src/o11y/otlp/mappers/codex.ts`）归一，但那个符号没有从
  `"niceeval/adapter"` 的公开导出面暴露出来——黑盒示例只能拿到已发布的公开 API，深路径导入会被
  `package.json` 的 `exports` 挡掉。这不是本次疏漏，详见
  `memory/codex-mapcodexspans-not-publicly-exported.md`。省略 `spanMapper` 时 core 走通用
  heuristic 兜底，瀑布图仍然能画，只是没有 codex 专属的 span 命名归一。

## 跑起来

```sh
cd examples/zh/tier1/codex-sdk
pnpm install
cp .env.example .env   # 填 CODEX_API_KEY / CODEX_BASE_URL
pnpm exec niceeval list
pnpm exec niceeval exp codex-sdk
pnpm exec niceeval view
```

不需要单独起前端或后端进程——`niceeval exp` 第一次 `send` 时会自动 spawn `src/backend/server.ts`，
跑完这次 CLI 进程退出时一并杀掉。`workspace/` 目录会在磁盘上留下 eval 跑过的文件（比如
`niceeval-create-file.txt`），这是预期行为，不需要手动清理——`create-file.eval.ts` 每次跑之前会
自己删掉它要检查的那个文件,保证断言看到的是这一轮真实写入的内容。
