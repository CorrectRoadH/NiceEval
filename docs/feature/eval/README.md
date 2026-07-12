# Eval —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。

## `defineEval` 的形状

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description?: string;            // 人读的描述,出现在报告里
  tags?: string[];                 // 供 --tag 过滤
  judge?: JudgeConfig;             // 覆盖默认裁判模型
  reporters?: Reporter[];          // 这个 eval 专用的报告器
  timeoutMs?: number;              // 覆盖默认超时
  metadata?: Record<string, unknown>;
  async test(t) { /* 交互 + 断言 */ },
});
```

**禁止**提供 `id` / `name` —— 它们从文件路径推导:`evals/weather/brooklyn.eval.ts` → id `weather/brooklyn`。改名即改 id,不会腐烂。

单轮、多轮、数据集扇出、沙箱型的完整写法见 [Library](library.md);API 取舍背后的设计依据见 [Architecture](architecture.md)。评分手段(judge、匹配器、gate/soft)单独成篇,见 [Scoring](../scoring/README.md)。

## 相关阅读

- [Library](library.md) —— 单轮、多轮、HITL、数据集扇出、沙箱型的完整写法与命名约定。
- [Architecture](architecture.md) —— 为什么作用域断言按接收者(`t` / `session` / `turn`)分层,对齐 eve 的设计依据。
- [Assertions](../../assertions.md) —— `t.check` / 作用域断言的完整速查表(看哪一轮、来源哪里)。
- [Scoring](../scoring/README.md) —— judge 细节、测试即评分、判定规则。
- [Agents 与 Adapters](../adapters/README.md) —— agent 三类 transport 与 agent 适配。
- [Experiments](../experiments/README.md) —— eval 由谁跑、跑几次、对着哪个 agent。
