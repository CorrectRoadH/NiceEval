# Scoring —— 评分器与判定

评分把"一个 attempt 的结果"折叠成一个 **Verdict**。niceeval 有五类评分手段,它们产出统一的 `Assertion`(带名字、严重度、分数),最后由判定规则汇总。**这一篇只讲断言收集完之后怎么变成判定**;每类断言具体是什么、看哪一轮、来源哪里,查 [Assertions](../../assertions.md)。

五类(详情见 Assertions 对应小节,API 用法见 [Library](library.md)):

1. **值断言** —— `t.check` / `t.require` 配 `expect` 里的匹配器。`check` 同步记录并继续收集其它断言;`require` 立即等待 matcher 结果,作为前置条件失败中止。见 [Assertions · 值断言](../../assertions.md#值断言)。
2. **作用域断言** —— `t.succeeded()` / `t.calledTool()` 等,在 `test` 结束后对本次 eval run 聚合评估;同一套断言挂在 `session` 上看单条 session,挂在 `turn` 上只看这一轮。见 [Assertions · API 分组速查](../../assertions.md#api-分组速查)。
3. **LLM-as-judge** —— 用一个裁判模型给开放式回答打分,`t.judge` / `session.judge` 默认评对应 session,`turn.judge` 默认评当前 turn,API 见 [Library](library.md#llm-as-judge)。
4. **测试即评分**(沙箱型) —— 手工在沙箱里跑测试与命令,把命令结果交给 `t.check`,见 [Library](library.md#测试即评分沙箱型)。
5. **效率 / 成本断言** —— `t.maxTokens()` / `t.maxCost()` 等,把 token 花费也变成可判的维度。见 [Assertions · 作用域断言共享词汇](../../assertions.md#作用域断言共享词汇)。

## 严重度:gate vs soft

每个断言有一档严重度,决定它如何影响判定(完整定义见 [Assertions · 严重度](../../assertions.md#严重度gate-vs-soft)):

- **gate** —— 硬性要求,不过 → 整个 eval `failed`,任何时候都生效。`includes` / `equals` 等默认 gate。
- **soft** —— 质量分,不会单独让 eval 立即 fail。`.atLeast(x)` 本身就是 soft 带阈值的写法:非 `--strict` 下低于 x 仍 `passed`(分数照样如实记录),`--strict` 下才改判 `failed`。不调 `.atLeast()` 也不调 `.gate()` 时,走匹配器自己的默认档:`similarity` 默认 soft、阈值 0.6;judge 默认 soft、没有阈值,纯记分,任何时候都不会 fail。

> 判定只有 **passed / failed / errored / skipped** 四态,没有 `scored` 中间态。"分数不够任何时候都要 fail" → 用 `.gate()`(或默认就是 gate 的匹配器);"分数不够只在 `--strict` 下才算 fail" → 用 `.atLeast(x)`;"只想记个分,永不影响判定" → 不调 `.atLeast()`,用默认走 soft、无阈值的匹配器(如裸的 judge 调用)。

这条规则横跨值匹配器和 judge,行为一致:

```typescript
t.check(t.reply, includes("晴"));                     // 默认 gate
t.check(t.reply, similarity(expected).atLeast(0.8));  // soft + 阈值:非 --strict 只记分;--strict 下 < 0.8 才 fail
t.judge.autoevals.closedQA("礼貌");                   // 无阈值 = 默认 soft、纯分数(永不挂)
t.judge.autoevals.closedQA("礼貌").atLeast(0.7);      // soft + 阈值:--strict 下 < 0.7 才 fail
```

## 判定规则

所有断言收齐后,运行器直接折叠成一个互斥的 **Verdict**——只有四态,没有中间的 `scored`(定义见 [Concepts · Verdict](../../concepts.md#评测核心词汇)):

```text
显式 t.skip(reason)                                     → skipped
执行出错(超时 / 异常 / 作者错误)                         → errored
任一 gate 断言不过,或 --strict 下有 soft 断言低于阈值    → failed
否则                                                     → passed
```

`failed` 只表示断言 / 评分不通过,`errored` 是环境、超时、adapter、agent runtime 等执行问题——两者互斥,`summary.failed` 与 `summary.errored` 分开计数。看报告、JUnit 或 CI 判红时按这个口径区分"agent 做错了"和"环境出问题了",不要混着看。

soft 断言(`.atLeast(x)`,或匹配器自己默认走 soft 档)不会单独造成 `failed`——除非开了 `--strict` 且它是带阈值的 `.atLeast(x)`。分数以 chip / 行尾徽章展示在每条 eval 详情里,供横向对比质量用。要让"分数不够"任何时候都 fail,用默认就是 gate 的匹配器,或显式 `.gate()`。

多次运行(`runs > 1`)时,eval 的汇总是**通过率**(pass 占比)与平均耗时,而非单一 Verdict。

## 相关阅读

- [Library](library.md) —— LLM-as-judge API、测试即评分、自定义评分器。
- [Assertions](../../assertions.md) —— 每条断言做什么、看哪一轮、来源哪里(值 / 作用域 / sandbox 结果 / 轮级的完整速查表)。
- [Authoring](../eval/README.md) —— 断言出现在哪种 eval 里。
- [Observability](../../observability.md) —— transcript / o11y,作用域断言的数据来源。
- [Concepts](../../concepts.md) —— Severity / Verdict 的术语定义。
