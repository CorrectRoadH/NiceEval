# Reports 的测试架构

契约来源：[Reports](../../../../feature/reports/README.md)、[Architecture](../../../../feature/reports/architecture.md)、[Library](../../../../feature/reports/library.md)、[Show](../../../../feature/reports/show.md) 和 [View](../../../../feature/reports/view.md)。用例登记在 [cases.md](cases.md)。

单元层证明 Reports 的**数据语义**：`*Data` 计算函数、指标聚合口径、resolve 管线、报告定义的装载规范化与校验反馈。观察面全部是数据——计算结果、规范化结构、错误对象与文案。渲染出来的终端排版、DOM 结构、双面比对、样式与交互不在本层，归 [E2E 功能域 · 报告与读面](../../e2e/report.md)对真实运行的产物验收（先例台账：[codeview-perline-hidden-scrollbar-clips-text](../../../../../memory/codeview-perline-hidden-scrollbar-clips-text.md)、[attempt-detail-components-shipped-without-styles](../../../../../memory/attempt-detail-components-shipped-without-styles.md)——渲染缺陷在单元层的 DOM 断言下照样逃逸，只有真实产物上的验收拦得住）。

## 计算 fixture 要有区分力

通过率 fixture 应让几种常见错误算法得到不同答案：

```ts
const scope = reportScopeFixture({
  experiments: [{
    id: "compare/codex",
    evals: [
      // 题 a：题内 2/3
      { id: "a", attempts: ["passed", "failed", "passed"] },
      // 题 b：题内 1
      { id: "b", attempts: ["passed"] },
      // 题 c：执行未形成可信判定；端到端记 0，条件任务通过率不计
      { id: "c", attempts: ["errored"] },
      // skipped 不进入有效样本，但保留在 total
      { id: "d", attempts: ["skipped"] },
    ],
  }],
})
```

这个 fixture 中：

- 默认端到端成功率是 `(2/3 + 1 + 0) / 3 = 5/9`。
- 条件任务通过率排除 errored，得到 `(2/3 + 1) / 2 = 5/6`。
- 端到端 attempt 平铺是 `3/5`。
- 先把每题折成"任一轮通过"再计票是 `2/3`。

这些值必须彼此不同，测试才能发现排除 error、平铺 attempt 或先折叠 verdict 等错误算法。各题 attempt 数必须不同，否则两级聚合与平铺可能恰好相等。

## MetricCell fixture

所有指标组件共享三种不能混淆的值：

```ts
const cells = {
  measuredZero: {
    value: 0,
    display: "0",
    samples: 2,
    total: 2,
    refs: ["@1aaaaaaa", "@1bbbbbbb"],
  },
  partial: {
    value: 0.5,
    display: "50%",
    samples: 1,
    total: 2,
    refs: ["@1aaaaaaa"],
  },
  missing: {
    value: null,
    display: "no data",
    samples: 0,
    total: 2,
    refs: [],
  },
} satisfies Record<string, MetricCell>
```

每个组件至少验证 `null` 不被显示成 `0`、partial 保留覆盖率、refs 没有被渲染前计算丢掉。

## 观察面：数据级断言

1. **`*Data` 计算的事实**：数值、覆盖率、排序、缺失行为，全部数据级断言。
2. **装载与 resolve**：`defineReport` 规范化、spec/data 等价、记忆化、非法输入的完整用户反馈——断言规范化结构与错误对象，不断言渲染结果。
3. **计算与格式化分别可断言**（`value` 与 `display` 独立），不从渲染字符串反推计算正确。

## Attempt 详情组件族的观察面

Attempt 详情（`AttemptSummary` 等 11 个叶子 + `AttemptAssessment` / `AttemptDetail` 两个组合，物理位置见 [source-map](../../../../source-map.md)）在本层只验收数据与装配语义：

- **纯派生，注入数据**：`attempt*Data(evidence)` 只做同步/纯派生，不读文件、不 fetch；`AttemptEvidence` 由 `loadAttemptEvidence` 一次装配。测试直接构造 `AttemptEvidence` fixture 或调用 `attempt*Data`，不需要（也不能）mock fetch——这些组件从不 fetch。
- **断言数据事实**：投影结构（轮次划分、回复归并、能力位）、组合组件的展开树构成、spec/data 等价、错位使用时的完整用户反馈。
- **渲染归 E2E**：两面输出、默认展开标记、染色、布局与交互由 [E2E 功能域](../../e2e/report.md)在真实 attempt 文档上验收。改动这些组件后需要 `pnpm run build:report`，改动 view 壳 / dialog 摆放后需要 `pnpm run view:build`。
