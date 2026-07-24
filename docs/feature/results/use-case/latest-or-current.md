# 读最近一批，还是每题的当前结果

## 解决什么问题

一次 Experiment 可能只补跑部分 Eval。此时“最近一批结果”和“每道题当前可用的结果”不是同一个范围：

- `latest()` 回答“最近一次执行实际产出了什么”；
- `current()` 回答“按当前配置，每道题最近一次可比的结果是什么”。

选错 API 会造成两种相反的误读：把未补跑的题当成缺失，或者把不同配置下的旧结果拼进当前比较。

## 场景

假设 Experiment `baseline` 选择 Eval `a` 和 `b`，先后产生三份结果快照：

| 结果快照 | 配置         | 实际包含   |
| -------- | ------------ | ---------- |
| `S1`     | `model: old` | `a`、`b`   |
| `S2`     | `model: new` | `a`、`b`   |
| `S3`     | `model: new` | 只补跑 `a` |

`S3` 是最新结果快照，但它没有 `b`。

## 全流程

1. **查看最近一次执行。** 调用 `results.latest()`。`baseline` 只返回 `S3` 中的 `a`，并通过
   `coverage.missingEvalIds` 报告 `b` 缺失。它不会从旧结果快照拼入 `b`。

2. **查看当前可用结果。** 调用 `results.current()`。`a` 来自 `S3`，`b` 来自
   `S2`。两条 Attempt 都属于 `model: new`，因此可以组成当前范围。Scope 保留 `S2`、`S3`
   两个真实来源，不制造一份合成结果快照。

3. **拒绝不可比的旧结果。** `S1` 中也有 `b`，但配置是 `model: old`。 `current()`
   不会用它填补当前配置的缺口。若 `S2` 不存在，`b` 会留在 `coverage.missingEvalIds`。

4. **只看本次新执行。** 在任一口径上使用
   `fresh: true`，都会排除携带结果和从旧结果快照拼入的 Attempt。被排除的 Eval 仍进入覆盖缺口，不会静默消失。

5. **继续收窄。** `Scope.filter()` 只能删除已有来源。删除 `S2` 后，来自 `S3` 的 `a` 仍保留，`b`
   回到覆盖缺口。过滤不会修改原 Scope。

## 边界

- `latest()` 的单位是结果快照，不是逐 Eval 找最新。
- `current()` 可以保留同一 Experiment 的多个来源结果快照。
- `current()` 只拼接可比配置；缺数据比混入错误条件更诚实。
- Attempt 始终指向真实来源。Scope 不重写 locator，也不制造合成来源。
- 需要查看历史趋势时，不要用 `current()` 代替时间序列。改用 Reports 的
  [Experiment 历史用例](../../reports/use-case/track-experiment-history.md)。
