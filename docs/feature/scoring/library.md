# Scoring —— 库用法

`t.judge` / `session.judge` / `turn.judge` 与自定义 `makeAssertion` 是这个功能的 API 面。概念(五类断言、gate/soft、判定规则)见 [README](README.md)。

## LLM-as-judge

用于"对不对靠规则说不清"的开放式回答。裁判模型与被测 agent **完全分离**,避免自评。

```typescript
t.judge.autoevals.factuality(expected).atLeast(0.8);      // 事实一致性
t.judge.autoevals.closedQA("是否适合 10 岁小孩理解");        // 闭合式判断
t.judge.autoevals.summarizes(source);                      // 是否忠实摘要

const turn = await t.send("解释一下量子隧穿。");
turn.judge.autoevals.closedQA("这一轮回答是否适合高中生理解");
```

`closedQA`/`factuality`/`summarizes` 挂在 `t.judge.autoevals.*`、`session.judge.autoevals.*` 和 `turn.judge.autoevals.*` 下,不留平铺别名。judge 就是这三个固定形状,评什么都落进 `closedQA`/`factuality`/`summarizes` 之一,材料也可以通过 `{ on }` 显式传。

`{ on }` 指定被评的值,`{ model }` 可单次覆盖裁判模型。默认材料由接收者决定:`t.judge` / `session.judge` 默认评对应 session 的对话文本;`turn.judge` 默认评这一轮的 `turn.message`。

> **judge 默认材料按接收者分层。** `t.judge` / `session.judge` 是 session 级,适合评当前会话的整体回答质量或跨轮一致性;`turn.judge` 是 turn 级,只评这一轮的 `turn.message`。要评 sandbox 产物/diff 或其它自定义材料,显式传 `{ on }`,例如 `t.judge.autoevals.closedQA("…", { on: t.sandbox.diff.get(path) }).atLeast(0.7)`。每条断言看哪一轮、各自来源,见 [Assertions](../../assertions.md)。

**模型解析优先级**(高 → 低):单次调用的 `{ model }` → 这个 eval 的 `judge.model` → 配置的 `judge.model` → 环境变量 `NICEEVAL_JUDGE_MODEL`。**没有内置默认模型**:解析不到 model 而 eval 用到了 judge 断言,会报清晰错误(而不是静默打向某个写死的模型)。

**没解析到 API key 时,整个 judge 命名空间降级成 no-op**:`t.judge.autoevals.*` 照常可调、可链 `.atLeast()` / `.gate()`,但**一条 judge 断言都不记录**,不出现在报告里,eval 的其余断言照常评。这是有意的:judge 需要一个额外的裁判模型 key(`judge.apiKeyEnv` → `NICEEVAL_JUDGE_KEY` / `CODEX_API_KEY` / `OPENAI_API_KEY`),没配 key 的环境(别人的机器、只跑冒烟的 CI)不该因为「环境里没有 judge key」就整批 fail,也不该逼每个 eval 自己写一遍环境判断。代价是**没配 key 时 judge 断言是静默消失的**——CI 里要求 judge 必须真的跑,就用 `judge` 配置显式声明并在流水线里检查 key 是否注入,别依赖"报告里有 judge 分"来反推。

```typescript
// niceeval.config.ts —— 全局默认
defineConfig({ judge: { model: "anthropic/claude-haiku-4-5" } });

// 某个 eval 覆盖
defineEval({ judge: { model: "anthropic/claude-opus-4-8" }, async test(t) { ... } });
```

## 测试即评分(沙箱型)

沙箱型里,你在 `test(t)` 里手工跑的验证命令本身就是评分材料:调 `t.sandbox.runCommand(...)` 跑测试(vitest 或别的什么都行),再用 `t.check(result, commandSucceeded())` 断言退出码 0。命令执行和评分分开,不会再有 `scriptPassed()` / `testsPassed()` 这种既像执行又像断言的 API。

```typescript
import { commandSucceeded } from "niceeval/expect";

const test = await t.sandbox.runCommand("npm", ["test"]);
t.check(test, commandSucceeded());
```

这让你用熟悉的测试语法表达"什么算对",并能断言文件内容、构建结果、甚至 agent 行为(经 `__niceeval__/results.json`)。没有另一层"validation 模式"开关——跑不跑测试、跑什么测试,都是 `test(t)` 里的普通代码决定的。详见 [Authoring](../eval/library.md#沙箱型手工把文件放进沙箱)。

## 效率 / 成本断言

token 用量是评分的一等维度 —— agent 答对了但烧掉十倍 token,不该和省着用的拿一样的分。这把「质量」和「效率」拆成两组断言,跨 agent 对比时就能同时看通过率和花费。用量自动随结果带回(沙箱型从 transcript 抠,见 [Observability](../../observability.md#用量与成本token--计费));`maxTokens()` / `maxCost()` 是作用域断言词汇的一部分,挂在 `t` 上看整个 attempt,挂在 `session` 上看单条 session,挂在 `turn` 上看单轮。具体用法、默认严重度见 [Assertions · 作用域断言共享词汇](../../assertions.md#作用域断言共享词汇)。

## 自定义评分器

值断言就是 `(value) => number | Promise<number>`,直接写:

```typescript
import { makeAssertion, type Assertion } from "niceeval/expect";

function jsonValid(): Assertion {
  return makeAssertion({
    name: "jsonValid",
    severity: "gate",
    score: (value) => { try { JSON.parse(String(value)); return 1; } catch { return 0; } },
  });
}

t.check(t.reply, jsonValid());
```

需要跨多次运行聚合的指标(如 pass@k、平均工具数),在 reporter 层做,见 [Observability](../../observability.md#reporters)。

## 相关阅读

- [README](README.md) —— 五类断言总览、gate/soft、判定规则。
- [Assertions](../../assertions.md) —— 每条断言做什么、看哪一轮、来源哪里。
