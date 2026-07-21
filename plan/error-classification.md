# PLAN：turn 级瞬时错误分类与有界重试

## 契约（单一来源，先读再动手）

- `docs/feature/error-classification/README.md` —— 完整契约：`TurnErrorKind` 三分类与重试安全性判据、adapter 覆盖 + 兜底分类器分层、挂载点（只包 `agent.send`）、退避参数（4 次封顶 / 基数 5s / 全抖动 / 释放槽位 / activity 反馈 / 复用外层 deadline）、耗尽后走原 `turn-failed` 路径、与 run 级 fail-fast 的关系、非目标。
- `docs/runner.md` 首过即停一节已声明「fail-fast 看到的 turn-failed 是重试耗尽后的最终结果」。
- 用户文档已更新：`docs-site/zh/explanation/runner.mdx` 「Turn 瞬时错误重试」一节。

## 已核实的源码落点（上一轮调查验证过，动手前再对一遍）

- turn 失败拍平点：`src/runner/attempt.ts:711-714`、`src/context/context.ts:513-519`（i18n key `context.turnFailed`）。
- 被包住的调用：`src/context/session.ts:245` 的 `this.deps.agent.send(...)`；会话记账（`turnCount` 自增、`userEvent` 推入）发生在 send 之前，重试不得重复。
- run 级 fail-fast streak：`src/runner/run.ts:717-726`——不改它。
- 形状参照：`src/sandbox/errors.ts`（`SandboxIoErrorKind` 与保守正则）、`src/sandbox/retry.ts`（退避执行体与 `ProvisionSlot` 槽位接口——**复用接口，不复用/不修改 provisioning 重试实现**）。

## 实现范围

1. **分类器**：新模块（建议 `src/context/turn-errors.ts`）：`TurnErrorKind`、`isRetryableTurnError`、保守兜底 `classifyTurnError(error)`。正则按契约判据写：限流关键字 / 明示 retry later → `rate_limit`；连接建立层（DNS / 拒连 / TLS / 首字节前超时）→ `network`；流中断、响应中途 reset、其余 → `unknown`。真实样本「Concurrency limit exceeded for user, please retry later」必须归 `rate_limit`。
2. **adapter 覆盖面**：agent 契约上加可选 `classifyTurnError?`（与 provider 自带 `classifyProvisionError` 同套路）；本次不为任何内置 adapter 写专属分类器（样本不足，兜底即可），只留好挂载点。
3. **重试执行体**：包住 `session.ts` 的 `agent.send(...)` 一次调用。封顶 4 次尝试、基数 5000ms、指数 + 全抖动；退避期间经 `ProvisionSlot` 接口释放并发槽位、睡醒重新排队；进度走 `reportActivity`，不产生 diagnostic；退避睡眠必须可被 Effect interruption 干净打断（外层 attempt deadline 原样生效，不新增超时语义）。
4. **耗尽路径**：不改 `expectOk()` → `TurnFailed` → `AttemptError{code: "turn-failed"}` 及任何下游契约；fail-fast、`errored` 判定、结果格式零变化。

## 测试（只实现已登记的行）

- `docs/engineering/unit-tests/eval/cases.md` 「Turn 瞬时错误与重试」分区：4 行（分类器归类、adapter 覆盖回落、只包 send 不重放记账、封顶/activity/耗尽/interruption）。
- `docs/engineering/unit-tests/experiments-runner/cases.md` 「并发」分区：退避释放槽位一行。
- 用 scripted agent fixture 注入瞬时/确定性失败序列；受控时钟，不用真实 `setTimeout` 睡眠。

## 验证与收尾

- `pnpm run typecheck`；`pnpm test`。
- 新公开类型（`TurnErrorKind` 等若导出）补 TSDoc 并跑 `pnpm docs:reference`；不导出则不动参考页。
- `docs/source-map.md` 补契约 → 源码落点。
- 行为无新 CLI 面，无需 i18n `--help` 变更。
