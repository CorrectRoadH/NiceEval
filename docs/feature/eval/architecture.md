# Eval —— 架构

内部设计依据,用于解释 API 取舍;作者写 eval 的直接用法从 [`defineEval` 的形状](README.md#defineeval-的形状) 开始。

## 设计依据:为什么对齐 eve 的接收者模型

<--手动维护,不允许删改本段内容,只允许添加-->
# 核心原因
1. API应该容易理解,不会有二义性
1.1 负面例子,`t.messageIncludes(token)` 和 `t.calledTool(name, opts?)` 其它同样的断言API应该都是有同样语义的(比如同指是最后一次t.send,返回的消息,而不是有的是全部,有的是单轮)。如果用户想对整个消息进行评估,可以自己拼接、保存每轮的回复。
1.2 API唯一,如无必要,不应该有两个做一样事的API。

2. 给用户自组织的能力,而不是约定大于配置。用户不想学太多约定。
2.1 比如能不能把fixture、workspace(拷文件。通过基本API让用户自己去处理,而不是我们给一个值,让过程黑箱)
2.2 用户在用 langfuse、promptfoo 这种传统的 prompt 评估,有一些问题,像 dataset、golden,不是很适用于 Agent 的 case。 Agent eval可能更关注多轮对话、同时可能不同case的评估内容也不一样。所以统一的dataset。input与execpt output不太行。
2.2.1 如果用户真的需要dataset,可以通过for来实现这个功能
eve是怎么做到这个的
```ts
import { defineEval } from "eve/evals";
import { loadYaml } from "eve/evals/loaders";
import { equals } from "eve/evals/expect";
const doc = await loadYaml("evals/data/cases.yaml");
const rows = doc.evals as readonly { task: string; prompt: string; sql: string }[];
export default rows.map((row) =>
  defineEval({
    description: row.task,
    async test(t) {
      await t.send(row.prompt);
      t.succeeded();
      t.check(t.reply, equals(row.sql));
    },
  }),
```
<--end-->

### 补充:作用域按接收者决定,对齐 eve

核对 eve 源码(本机 `/Users/ctrdh/Code/eve/packages/eve/src/evals/`),把 1.1 说的"作用域"坐实成经验证的设计。

**eve 的真实实现**:`assertions/scoped.ts` 的 `createScopedAssertions` 是**一份实现**,导出 `succeeded` / `messageIncludes` / `calledTool` / `notCalledTool` / `toolOrder` / `usedNoTools` / `maxToolCalls` / `calledSubagent` / `noFailedActions` / `event` / `notEvent` / `eventOrder` / `eventsSatisfy` / `parked` 这一整套,靠调用时绑定的 `scope` 决定读哪份数据,一共绑在三个地方:

- `context.ts:77`:`t` 自己绑 `{ timing: "final", select: (result) => result }`。`result` 是 `EveEvalTaskResult`,由 `runner/execute-task.ts:98`(`buildTaskResult`)构造:`events: input.sessions.flatMap(session => session.events)` —— **把这次 eval run 涉及的全部 session(含 `t.newSession()` 开的)的全部轮次拍平合并**,在 `test()` 跑完、`collector.finalize(result)` 时才求值。
- `session.ts:73-83`:`t.newSession()` 返回的 session 也绑同一套断言,但它是 snapshot scope,只看这个 session 在断言记录时已经发生的事件。
- `session.ts:298-308`(`EvalTurn` 构造函数):`t.send()` 返回的 turn 对象绑 `{ timing: "snapshot", select: () => this.#assertionSubject() }`,`#assertionSubject()` 只读**这一轮自己的** `events`(`session.ts:221-243` 的 `#recordTurn` 传入的就是这次 `send()` 的 `result.events`,不含之前轮次)。

这些绑定共享**同一套完整函数**,区别只是"挂在哪个对象上",不是"叫什么名字"——eve 没有"`messageIncludes` 天生看全部、`calledTool` 天生看单轮"这种按名字区分的不一致。1.1 要避免的正是这种不一致,eve 靠"位置决定作用域、每个位置给全套词汇"解决,不是靠"取消聚合"解决。

**niceeval 对齐到这个设计,不是取消聚合**:

- `t.*` 保留"聚合整个 eval run"的语义——这次 eval 执行的全部轮次、含 `t.newSession()` 开的额外 session,直接对应 eve 的 `timing: "final"` 层。这一层聚合是有意为之,不是要移除的"黑箱"。
- `session.*`(`t.newSession()` 的返回值)复用 `t.*` 的同一套**作用域断言词汇**,但只看这个 session 在断言记录时已有的事件。
- `turn.*`(`t.send()` 的返回值)也复用同一套**作用域断言词汇**,但只看这一轮自己的事件和用量。`turn.outputEquals` / `turn.outputMatches` 是 turn 独有的(只对单轮结果有意义,聚合层不需要)。

也就是:**接收者决定作用域,不是断言名字决定作用域。** author-facing 接收者是 `t` / `session` / `turn`;`Attempt` 只作为 runner/result 里的执行单位存在,不是写 eval 时要操作的一层。完整清单见 [Scoring · 作用域](../scoring/architecture/scopes.md)。

## 相关阅读

- [README](README.md) —— `defineEval` 的核心契约。
- [Library](library.md) —— 单轮、多轮、数据集扇出、沙箱型的完整写法。
- [Scoring Architecture](../scoring/architecture.md) —— 作用域、严重度、判定与证据不变量。
