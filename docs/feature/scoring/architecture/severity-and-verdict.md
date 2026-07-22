# Severity 与 Verdict

## Severity

- **gate**：硬要求，通过线默认 1（matcher 自身的及格线），不过即 failed。
- **soft**：质量指标。**无通过线＝纯记录**，分数如实落盘、永不 fail；**有通过线**＝低于线记该条 failed，默认不改 Verdict，strict 模式下才计入。

严重度句柄三个词、三种互不重叠的行为（对齐 eve）：

- `.gate(x?)` —— 升级为硬要求。省略 `x` 用默认通过线 1；打分断言可给 `x` 指定硬阈值。
- `.atLeast(x)` —— 降级为带通过线的 soft。`x` 是**分数线**：0/1 断言写 `.atLeast(1)`（挂了照实记 failed，`--strict` 才拖垮 Verdict），打分断言写 `.atLeast(0.7)`。
- `.soft()` —— 降级为纯记录的 soft，不设线（judge 的默认严重度就是它）。**无参数**——要设线用 `.atLeast(x)`，不提供同义的 `soft(x)`。

`.atLeast` 的参数是分数线，不是调用次数——「至少调用 n 次」在匹配条件的 `count` 里表达（数字恰好、谓词自定，见[作用域断言](../library/scoped-assertions.md#匹配条件的字段全集)）。

## Verdict

Verdict 只有 passed、failed、errored、skipped，按固定优先级取第一个成立项：

```text
执行异常、超时、作者错误，或任一非 optional 断言 unavailable   → errored
任一 gate 不通过，或 strict 下任一 soft 不通过                 → failed
显式 t.skip(reason)                                            → skipped
否则                                                           → passed
```

Errored 压过一切，因为执行证据已经不可信。Failed 压过 skipped，避免 `t.skip()` 掩盖此前记录的硬失败。

## 证据不可用（unavailable）不折叠成通过

一条断言评不了和它通过、失败都是两回事。以下情况把该条 `AssertionResult` 记为 `outcome: "unavailable"`（带机器可读 `reason`），绝不静默丢弃、绝不按空证据判通过：

- **负断言与上限断言的证据通道不完整**——`notEvent` / `usedNoTools` 这类「确认没发生」的断言，以及 token / cost 上限断言，依赖完整采集；所需通道非 complete 时（含 unknown，见[证据与完整性](evidence.md)），空流不能证明「没发生」，缺 usage 不能按零聚合。
- **正断言在非 complete 通道上没找到匹配**——「没采到」不能算成「Agent 没做」；找到匹配则照常通过（证据存在就是证据），complete 通道上没找到才是 failed。
- **judge 没有解析到模型或 API key**——rubric 写了就必须留下记录（见 [LLM-as-judge](../library/judge.md)）。

折叠规则只有一条：**作者写下的每条断言默认都要求可评估**——任一非 optional 断言 unavailable，attempt 即 `errored`，不分 gate / soft。评不了的结论不可信，不能当 agent 答对，也不该当 agent 答错；「soft 全部评不了但 attempt 还绿着」是没有测量的绿，不允许出现。确实允许缺席的断言由作者显式链 `.optional()`——它的 unavailable 只保留在记录里由报告如实展示，不影响 Verdict。optional 与 severity 正交：severity 说「影不影响质量判定」，optional 说「证据允许不允许缺席」，不互相复用。

Turn failed 和 attempt errored 不是同一概念：Agent 行为失败可以形成可评分结果；基础设施、超时或作者异常使本次执行无法形成可信结论。
