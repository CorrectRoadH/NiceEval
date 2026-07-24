# 诊断的去重 key 被当成 `--json` 的 `warning.code` 直接透出

## 现象

`--json` 事件流里 `warning` 事件的 `code` 字段不是 cli.md 承诺的稳定字面量,而是编进了身份的复合串:

```json
{"event":"warning","code":"lock-taken-over:compare/codex|memory/retention","level":"warning","message":"…"}
```

消费方没法按 `code === "lock-taken-over"` 分支——这个值每次运行、每条用例都不同。同一条诊断落
`snapshot.json` 时反而是干净的 `"lock-taken-over"`(持久化通路 `recordExperimentDiagnostic` 的
`code` 参数是独立传的),两条通路对同一件事说了两个词。

顺带的两个缺口:运行级诊断(实验闸 / eval 闸)不属于任何单条 attempt、不该伪造 `identity`,而
`json.ts` 只从 `event.identity?.experimentId` 取身份,于是止损闸的 `warning` 连 `experimentId` 都没有;
`WarningEvent` 也没有 `evalId` 槽位,eval 闸的 `data.evalId` 只有 `snapshot.json` 侧看得到。

## 根因

`DiagnosticInput` 只有一个 `key` 字段,同时承担两件不该合并的事:

1. **折叠粒度**——「这条诊断折叠到多细」(每实验一条?每用例一条?),所以必须把身份编进去;
2. **对外词法**——`--json` 的 `warning.code`、human 诊断行的标题,必须是可分支的稳定字面量。

`json.ts` 写 `code: event.key` 时把 1 当成了 2。这不是某个调用点写错,是类型上就没给 2 留位置——
所有把身份编进 key 的诊断(`lock-taken-over` / `fail-fast` / `budget-unenforceable` /
`experiment-teardown-*` / `dispatch-halted`)全部中招,只是 `dispatch-halted` 落地时才被发现。

## 修法

`DiagnosticInput` / `DiagnosticNotice` / `DurableFeedbackEvent` 的 `"diagnostic"` 变体各加一个可选
`code`:`key` 继续只管折叠粒度,`code` 是对外稳定词法,省略时回落 `key`(折叠身份本就不进 key 的
诊断天生就是干净字面量,不必逐个补)。`json.ts` 与 `human.ts` 都改读 `code ?? key`。

身份改成「`identity` 优先,回落 `data` 的同名字段」,并给 `--json` 的 `warning` 补 `evalId`——运行级
诊断把 `experimentId` / `evalId` 放 `data` 是既有约定(budget 的 `data.experimentId` 就是这么走的),
不为闸另造第三条通路,也不为了让身份透出去而伪造一个 attempt 级 identity。

落点:`src/runner/feedback/sink.ts`、`src/runner/types.ts`、`src/runner/feedback/{coordinator,reducer,json,human}.ts`、
`src/runner/run.ts` 各调用点(节点 C3)。**注意 `src/sandbox/**` 的调用点没有跟改**(`resolve.ts` 是
`key: d.dedupeKey ?? d.code`),它们仍走回落分支;真要收口得连沙箱侧的 `SandboxDiagnostic` 一起过一遍。

`src/cli.ts` 的 `assembleInvocationCompletion` 按 `d.key.startsWith("dispatch-halted:")` 归类未派发数,
依赖的是 `key` 不是 `code`,这次改动没动它——新增 `code` 时别顺手把身份从 key 里摘掉,那会静默打断
completion 的记账。
