# Eval —— Library 用例

本目录是编写 eval 的 Library API 用例文档（体裁约定见[功能文档](../../README.md)）：一篇讲一个真实用例的全流程——作者要评什么、从驱动到断言的完整写法、边界与何时改用别的模式。契约单源在 [Library](../library.md)、[Context](../library/context.md)、[Scoring](../../scoring/library.md) 与 [Sandbox](../../sandbox/library.md)，这里只做叙事串联，不复制契约定义。

从上往下读是一条学习路径：前两篇覆盖所有 eval 都会用的驱动与断言，后面各篇按需进入。

## 会话驱动

- [单轮：一问一答就断言](first-single-turn.md)
- [多轮与并行会话：每轮各自断，整段一起评](multi-turn-sessions.md)
- [HITL 审批：agent 停在人工输入上](hitl-approval.md)

## 评分

- [过程与成本：断 agent 怎么做到的](process-and-cost.md)
- [裁判评质量：规则写不出对错时](judge-quality.md)

## 规模与环境

- [数据集扇出：一套逻辑跑一批 case](dataset-fanout.md)
- [沙箱 coding 任务：从放文件到评 diff](sandbox-coding.md)
- [Fixture 与反馈：setup / teardown 与长步骤报告](fixtures-lifecycle.md)

## API → 篇目对照

| API | 所在篇目 |
|---|---|
| `t.send` / `t.sendFile` / `t.reply` / `turn.message` / `turn.data` | [单轮](first-single-turn.md) |
| `turn.succeeded` / `turn.judge` / `t.newSession()` / `session.*` | [多轮与并行会话](multi-turn-sessions.md) |
| `parked` / `requireInputRequest` / `respond` / `respondAll` | [HITL 审批](hitl-approval.md) |
| `calledTool` / `notCalledTool` / `toolOrder` / `usedNoTools` / `loadedSkill` / `calledSubagent` | [过程与成本](process-and-cost.md) |
| `event` / `notEvent` / `eventOrder` / `eventsSatisfy` | [过程与成本](process-and-cost.md) |
| `maxToolCalls` / `maxTokens` / `maxCost` / `noFailedActions` | [过程与成本](process-and-cost.md) |
| `t.group` / `.gate()` / `.atLeast(x)` / `.soft()` / `.optional()` | [过程与成本](process-and-cost.md) |
| `t.check` / `t.require` / `niceeval/expect` matcher | [单轮](first-single-turn.md) · [沙箱](sandbox-coding.md) |
| `t.judge` / `session.judge` / `turn.judge` / `autoevals.*` / `{ on }` / `.atLeast(x)` | [裁判评质量](judge-quality.md) |
| 数组导出 / keyed record 导出 / `loadYaml` / `loadJson` | [数据集扇出](dataset-fanout.md) |
| `t.sandbox.writeFiles` / `uploadDirectory` / `runCommand` / `runShell` | [沙箱 coding 任务](sandbox-coding.md) |
| `t.sandbox.diff` / `file` / `fileChanged` / `fileDeleted` / `notInDiff` | [沙箱 coding 任务](sandbox-coding.md) |
| `setup` / `teardown` / `t.progress` / `t.diagnostic` / `t.skip` | [Fixture 与反馈](fixtures-lifecycle.md) |
