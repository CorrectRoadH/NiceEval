---
name: attempt-summary-missing-started-at-attempt-ordinal
description: AttemptSummaryData 携带 startedAt/identity.attempt 但 attemptSummaryText 两者都没渲染——待补的 Phase H TODO,不是已裁决的设计
metadata:
  type: project
---

`attemptSummaryText`(`src/report/text/attempt-faces.ts`)只渲染 `data.locator`、`data.identity.evalId`、
`data.identity.experimentId`、verdict、`durationMs`、`costUSD`——`AttemptSummaryData` 上实际存在的
`startedAt`(何时跑的)与 `identity.attempt`(第几次重试)两个字段从未被读取,两面(text/web,web 面同样
没渲染)都看不到。

# Why 记这条而不是当场修

Phase E(`show @locator` 接线)审查这条时,一开始以为"locator 本身唯一,所以不需要单独显示 attempt
序号"——这个理由不成立:locator 解决的是**去重**(不会指向别的 attempt),不是**信息**(第几次重试、
什么时候跑的是独立事实,locator 不透明,读不出这两项)。真正站得住的理由是范围:`startedAt` 是
上下文元数据,不是判断"为什么失败"要看的证据,不属于 Phase E(接线 + 修复失败诊断链路可用性)的
必要范围,推迟不影响本次改动的正确性。

# How to apply

Phase H(docs/source-map/参考页同步)顺手把这个补上:
- `AttemptSummaryData`/`attemptSummaryData` 已经有这两个字段,不需要改计算层。
- 只需在 `attemptSummaryText` 追加一段(如 `data.startedAt` 存在时追加时间戳,`identity.attempt`
  非 0 或恒显示"attempt N"),web 面(`react/AttemptSummary.tsx`)对应加显示。
- 改之前check `docs/feature/reports/library/attempt-detail.md` 的 `AttemptSummary` 行是否需要跟着
  改措辞(当前只写"身份、verdict、开始时间、总耗时、成本"——「开始时间」已经在契约里,是实现没跟上,
  不是契约要新增)。
