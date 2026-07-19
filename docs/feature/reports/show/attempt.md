# 失败诊断首页

不带 `--report` 且无证据 flag 打开 attempt 时，选择内建 `standard` 中的 [attempt-input page](../library/attempt-detail.md)，注入 locator 并渲染其 `<AttemptDetail />` text 面；这张普通 page 就是本页所说的“诊断首页”，不是 show 宿主另藏的一套 renderer。`AttemptSummary` 先给身份与判定，`AttemptAssessment` 再用 `AttemptError` + `AttemptSource`（源码不可用时为 `AttemptAssertions`）按结果分节列断言：`failures:`（gate 失败）、`soft below threshold:`（soft 未达标）、`scores:`（无阈值 judge 的纯打分）、`unavailable:`（证据评不了，带 reason）——全通过的节省略。每条列分组、matcher、期望值、实际值和源码位置。带 `--report <file>` 时，选择该定义自己的 attempt-input page，content 与顺序可以不同：

```text
$ niceeval show @1qrdcfq8
@1qrdcfq8 · memory/swelancer-manager-proposals · dev-e2b/codex-e2b · failed
snapshot 2026-07-12T10:08:29.361Z · attempt 1 · 50.0s · 58.5k tokens · $0.05

assertions: 3 passed · 1 gate failed
eval source: evals/memory/swelancer-manager-proposals.eval.ts · sha256:ee33b9c4…

failures:
  gate · Issue 15193: selected proposal matches the accepted proposal
    assertion: equals(4)
    expected: 4
    received: 3
    source: evals/memory/swelancer-manager-proposals.eval.ts:40:11

execution: 12 events · 0 skill loads · 7 tool calls · 4 AI messages
timing: sandbox.queue 0.2s · sandbox.create 5.6s · sandbox.setup 3.5s · agent.setup 12.1s ·
        eval.run 26.3s · workspace.diff 0.3s · scoring.evaluate 1.4s · teardown +0.8s

changes: 2 files changed by agent · M manager_decisions.json · A notes/decision-log.md

artifacts: .niceeval/dev-e2b_codex-e2b/<snapshot>/memory/swelancer-manager-proposals/a0/
available:
  niceeval show @1qrdcfq8 --source
  niceeval show @1qrdcfq8 --execution
  niceeval show @1qrdcfq8 --timing
  niceeval show @1qrdcfq8 --diff
```

这页应当足以判断“为什么失败”。只有实际可用的命令才出现在 `available`；没有捕获某类证据时省略对应命令。只有在需要理解断言上下文、agent 为什么给出这个结果、或具体改了什么时，才继续打开证据切面：[`--source`](eval-source.md)、[`--execution`](execution.md)、[`--timing`](timing.md)、[`--diff`](diff.md)。

`timing:` 行是 `result.json` 里 `phases` 的一行摘要，阶段名就是 `LifecyclePhase` 闭集里的名字：主链阶段按执行序列出，为保持一行可读只列耗时可见的大头（`workspace.baseline`、`telemetry.*` 这类极短阶段并入 [`--timing`](timing.md) 的完整分解）；收尾段合计成一个 `teardown +N` 尾项——收尾不计入 attempt 总耗时，所以用 `+` 与主链区分。落盘没有 `phases`（旧结果或第三方 harness 写入）时这一行如实输出 `phase timing unavailable`，不猜。

`errored` attempt 的首页不用 trace 也必须能解释基础设施错误。它先显示结构化 error 的 phase、code、message 与有限 cause,再列本 attempt 的 diagnostics;stack 放在后面并保持原始换行。error 的 `phase`、diagnostics 的 phase 与 `timing:` 行用的是同一套 `LifecyclePhase` 名字,同一次失败在三处叫同一个名:

```text
$ niceeval show @12h8m4k1
@12h8m4k1 · memory/agent-029-use-cache · compare/claude-e2b · errored

error:
  phase: sandbox.create
  code: sandbox-rate-limit
  message: E2B sandbox allocation failed after 5 attempts
  cause: RateLimitError · too many concurrent sandboxes

diagnostics:
  warning · sandbox.create · fallback-region
    Primary region was unavailable; retried in us-west (2 occurrences)

execution: unavailable (attempt failed before telemetry was configured)
timing: sandbox.queue 1.2s · sandbox.create 2m 6s ✗ failed here
```

diagnostic 的 level 不等于 verdict:一个 passed/failed attempt 也可以带 cleanup warning。榜单只显示致命 error 的一层原因;diagnostics、cause 和 stack 留在 locator 首页,避免几十个并发 sandbox 错误淹没终端。

## 相关阅读

- [`--source`](eval-source.md) / [`--execution`](execution.md) / [`--timing`](timing.md) / [`--diff`](diff.md) —— 四个证据切面。
- [裸 `show` 的默认榜单](default-report.md) —— locator 从哪里来。
