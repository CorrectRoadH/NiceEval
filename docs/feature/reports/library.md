# Reports —— 库用法

`niceeval/report` 用来计算报告数据和定义可同时交给 `show`、`view` 渲染的报告；`niceeval/report/react` 提供可直接嵌入你自己 React 页面中的纯渲染组件。

最快的选择方式：先确定想回答的问题，再选组件。

| 想回答的问题 | 组件 |
|---|---|
| 这批结果有多大、整体是否健康 | `RunOverview` |
| 某一组 experiment 的整体情况 | `GroupSummary` |
| 每个 experiment / eval / attempt 发生了什么 | `ExperimentList` / `EvalList` / `AttemptList` |
| 谁整体更好，多个指标并排比较 | `MetricTable` |
| 哪道题在哪个配置上失败 | `MetricMatrix` 或 `MetricBars` |
| 固定题集的总分与分科得分 | `Scoreboard` |
| 两个指标之间的取舍 | `MetricScatter` |
| 参数变化时指标怎样变化 | `MetricLine` |
| A 与 B 相差多少 | `DeltaTable` |

## 两种使用方式

### 交给 `show` / `view` 渲染

报告文件默认导出 `defineReport(...)`。报告中的官方组件同时实现 text 和 web 两个面，一份定义可用于两个宿主：

```tsx
// reports/quality-cost.tsx
import {
  Col,
  ExperimentList,
  MetricScatter,
  Section,
  costUSD,
  defineReport,
  passRate,
} from "niceeval/report";

export default defineReport(async ({ selection }) => {
  const experiments = await ExperimentList.data(selection);

  return (
    <Col>
      <Section title="质量与成本">
        <MetricScatter
          selection={selection}
          points="experiment"
          series="agent"
          x={costUSD}
          y={passRate}
        />
      </Section>
      <ExperimentList items={experiments} />
    </Col>
  );
});
```

```sh
niceeval show --report reports/quality-cost.tsx
niceeval view --report reports/quality-cost.tsx
```

宿主先按位置参数、`--run` 和 `--experiment` 选择数据，再把 `selection` 注入报告。覆盖不完整、快照过旧或未完成等警告由宿主统一显示，报告不必自己补警告组件。

### 嵌入自己的 React 页面

自己的页面没有 niceeval 的异步解析阶段，因此先在服务端计算普通 JSON，再把 `data` 交给纯组件：

```tsx
import { openResults } from "niceeval/results";
import { MetricTable, RunOverview } from "niceeval/report/react";
import { costUSD, durationMs, passRate } from "niceeval/report";

export default async function EvalsPage() {
  const results = await openResults(".niceeval");
  const selection = results.latest({ experiments: "compare/" });

  const [overview, table] = await Promise.all([
    RunOverview.data(selection),
    MetricTable.data(selection, {
      rows: "experiment",
      columns: [passRate, costUSD, durationMs],
      sort: passRate,
    }),
  ]);

  return (
    <main>
      <RunOverview data={overview} />
      <MetricTable
        data={table}
        filter
        attemptHref={(locator) => `/attempts/${locator}`}
      />
    </main>
  );
}
```

组件输出完整静态 HTML。网页排序、过滤和图表 tooltip 是渐进增强；需要官方样式与增强脚本时引入 `niceeval/report/react/styles.css` 和 `niceeval/report/react/enhance.js`。

## 组件目录

每个组件都把配套计算函数挂在 `.data` 上。计算函数接受 `Selection` 或 `Snapshot[]`，返回可序列化数据；组件本身不读文件。

### 概览组件

#### `RunOverview`

显示快照时间、experiment / eval / attempt 数、通过率、总成本和 Selection 警告。适合作为报告页头。

```tsx
<RunOverview data={await RunOverview.data(selection)} />
```

#### `GroupSummary`

显示一个范围内的 experiment / eval / attempt 数、eval 级判定构成、通过率、成本和最后运行时间。先过滤 Selection，再计算摘要：

```tsx
const group = selection.filter((snapshot) => snapshot.experimentId.startsWith("compare/"));
<GroupSummary data={await GroupSummary.data(group)} />
```

### 实体列表

实体列表用于从汇总下钻到事实，不允许自由配置列。

#### `ExperimentList`

每项显示 experiment 身份、agent / model、flags、判定构成、官方指标和其中的 eval。适合总览页的主列表。

```tsx
const items = await ExperimentList.data(selection);
<ExperimentList items={items.filter((x) => x.experimentId.startsWith("prod/"))} />
```

#### `EvalList`

每项表示 `experimentId + evalId`，显示折叠判定、失败原因、分数、耗时、成本和全部 attempt。

```tsx
const items = await EvalList.data(selection);
<EvalList items={items.filter((x) => x.verdict !== "passed")} />
```

#### `AttemptList`

每项显示一次 attempt 的判定、断言、错误、Judge 证据、locator 和可用证据类型。适合做“最近失败”或“待处理失败”区块。

```tsx
const all = await AttemptList.data(selection, {
  redact: (text) => text.replaceAll(/sk-[A-Za-z0-9]+/g, "[redacted]"),
});
const failed = all.filter((x) => x.verdict === "failed" || x.verdict === "errored");

<AttemptList items={failed.slice(0, 20)} total={failed.length} />
```

`redact` 只处理 error、断言 detail 和 evidence；experimentId、evalId、locator 等身份字段不会被改写。

### 指标组件

#### `MetricTable`

一行一个维度值，一列一个指标。适合 benchmark 榜和配置比较。`sort` 决定初始顺序，方向由指标的 `better` 决定；`filter` 给 web 面增加行过滤框。

```tsx
<MetricTable data={await MetricTable.data(selection, {
  rows: "agent",
  columns: [passRate, examScore, costUSD, durationMs],
  sort: passRate,
  evals: "coding/",
})} filter />
```

#### `MetricMatrix` 与 `MetricBars`

二者使用同一份矩阵数据：Matrix 适合看“题 × 配置”的格子，Bars 适合比较每行的相对大小。

```tsx
const data = await MetricMatrix.data(selection, {
  rows: "eval",
  columns: "agent",
  cell: passRate,
});

<MetricMatrix data={data} />
<MetricBars data={data} />
```

矩阵是稀疏的：没有 attempt 的组合不生成格子。格子中的 `refs` 保留证据引用；在自有页面中传 `attemptHref` 可令格子跳到你的 attempt 页。

#### `Scoreboard`

把 eval 当题目，按固定题集算总分和分科得分。没跑到的题保留在分母中并按 0 分计，适合考试或合规检查，不适合“只统计有数据样本”的探索分析。

```tsx
<Scoreboard data={await Scoreboard.data(selection, {
  rows: "agent",
  subjects: "evalGroup",
  weights: { "security/": 3, "correctness/": 2 },
  fullMarks: 100,
  score: examScore,
})} />
```

权重按 eval id 前缀匹配；多个前缀都命中时，最长前缀生效。

#### `MetricScatter`

每个点是一个维度值，x / y 各一个指标，series 决定连线分组。适合质量 × 成本 frontier。

在 `defineReport` 中可以直接给 Selection：

```tsx
<MetricScatter
  selection={selection}
  points="experiment"
  series="agent"
  x={costUSD}
  y={passRate}
/>
```

在自己的 React 页面中先计算：

```tsx
const data = await MetricScatter.data(selection, {
  points: "experiment",
  series: "agent",
  x: costUSD,
  y: passRate,
});
<MetricScatter data={data} pointHref={(row) => `/experiments/${row.key}`} />
```

x 或 y 缺失的点不绘制，并显示缺失数量。少于两个可画点时组件显示明确空态，不用调用方自行隐藏。

#### `MetricLine`

用一个数值 flag 作为 x 轴，按 series 画指标趋势。适合 token budget、并发数、reasoning effort 等参数扫描。

```tsx
import { flag } from "niceeval/report";

<MetricLine data={await MetricLine.data(selection, {
  x: flag("budget", { label: "Token budget", unit: "tokens" }),
  series: "agent",
  y: passRate,
})} />
```

没有声明该 flag 或 flag 不是数值的 experiment 不会伪造 x 值，组件会报告未绘制数量。

#### `DeltaTable`

成对比较 A 与 B，并按指标的 `better` 判断 delta 是改善还是退化。适合基线 / 候选、无缓存 / 有缓存或两个快照的对比。

```tsx
<DeltaTable data={await DeltaTable.data(selection, {
  pairs: [
    { label: "memory", a: "baseline", b: "with-memory" },
  ],
  metrics: [passRate, costUSD, durationMs],
})} />
```

任一侧缺数据时 delta 保持缺失，不把缺失当 0。

## 指标

### 内置指标

| 指标 | 含义 | 越高/低越好 | 数据来源 |
|---|---|---|---|
| `passRate` | passed = 1，failed / errored = 0 | 高 | `result.json` |
| `examScore` | gate 决定能否得分，soft 断言给质量分 | 高 | `result.json` |
| `durationMs` | attempt 墙钟耗时 | 低 | `result.json` |
| `tokens` | input + output tokens | 低 | `result.json` |
| `costUSD` | 网关实测成本优先，否则估算成本 | 低 | `result.json` |
| `turns` | assistant turn 数 | 低 | `o11y.json` |

`skipped` 对这些指标返回 `null`。`turns` 需要 `o11y.json`；发布时没复制该 artifact 就显示缺失，不会冒充 0。

### 自定义指标

```ts
import { defineMetric } from "niceeval/report";

export const changedLines = defineMetric({
  name: "changed-lines",
  label: { en: "Changed lines", "zh-CN": "改动行数" },
  unit: "lines",
  better: "lower",
  where: (attempt) => attempt.result.verdict === "passed",
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;
    return Object.values(diff.generatedFiles)
      .reduce((sum, source) => sum + source.split("\n").length, 0);
  },
  aggregate: { perEval: "min", across: "mean" },
});
```

- `null` 表示测不了，不进入聚合；`0` 表示测得结果为零，会正常进入聚合。
- `where` 是进入计算前的显式条件，适合“只比较通过方案的代码量”。
- 聚合先在同一 eval 的多个 attempt 之间折叠，再跨 eval 折叠；两级默认都是 `mean`。
- `unit` 驱动内置格式化；需要特殊显示时提供 `display(value)`。

## 维度与 flags

可直接使用的维度有 `agent`、`model`、`experiment`、`eval`、`evalGroup` 和 `snapshot`。

自定义维度：

```ts
const verdictFamily = {
  name: "verdict-family",
  of: (attempt) => attempt.result.verdict === "passed" ? "pass" : "needs-work",
};
```

experiment 中声明的变量用 `flag()` 读取，不从 experiment id 字符串猜：

```ts
const reasoning = flag("reasoningEffort", { label: "Reasoning effort" });
const budget = flag("budget", { label: "Budget", unit: "tokens" });
```

未声明的分组 flag 归到 `(unset)`；作为数值轴时则不绘点并报告缺失。

## 数据计算与缓存边界

`.data(...)` 可能懒加载 artifact，因此应在服务端、构建脚本或 `defineReport` 的异步函数中调用。返回值是普通可序列化数据，可写成 JSON 供 SPA 使用：

```ts
const table = await MetricTable.data(selection, {
  rows: "experiment",
  columns: [passRate, costUSD],
});
await writeFile("public/evals.json", JSON.stringify(table));
```

计算产物只代表当时的 Selection。结果根变化后要重新调用 `.data(...)`；纯 React 组件渲染同一份 data 时不再读取磁盘。对于同一页面需要的多个组件，可用 `Promise.all` 并行计算。

所有指标格子都携带 `samples`、`total` 和 attempt `refs`。缺数据不会被填成 0，覆盖率与证据引用也不会因序列化而丢失。

## 布局与自定义组件

`Row`、`Col`、`Section`、`Text` 和 `Style` 用于组织报告树：

```tsx
return (
  <Col>
    <Text>nightly benchmark</Text>
    <Row>
      <Section title="Overall">...</Section>
      <Section title="Failures">...</Section>
    </Row>
    <Style>{`.nre .team-note { color: #6b7280; }`}</Style>
  </Col>
);
```

要让自定义组件同时出现在 `show` 和 `view`，用 `defineComponent` 同时提供 `web` 与 `text` 面。只服务自己网页的组件直接写普通 React 组件即可。

## 相关阅读

- [Show](show.md) —— 终端宿主与证据切面。
- [View](view.md) —— web 宿主与静态导出。
- [Architecture](architecture.md) —— 报告树、异步解析和宿主边界。
- [Results Library](../results/library.md) —— `openResults`、Selection 与 artifact 句柄。
