# Report 设计问题记录

## `docs/roadmap/report-chart-composition`

评审范围：`README.md`、`architecture.md`、`library.md`、`gallery.md`，并与 Reports 目标契约和 Recharts 3.x 官方 API 交叉核对。

### 评审前提

这是一次完整重构，不需要兼容现有 `MetricLine` / `MetricBars` 的扁平 API。评审只判断新 API 是否更好，以及能否在 niceeval 的 Metric、Dimension、双面渲染约束下尽量复用 Recharts 的语法和心智。

Recharts 官方参考：[`ComposedChart`](https://recharts.github.io/en-US/api/ComposedChart/)、[`Line`](https://recharts.github.io/en-US/api/Line/)、[`Bar`](https://recharts.github.io/en-US/api/Bar/)、[`ErrorBar`](https://recharts.github.io/en-US/api/ErrorBar/)、[`XAxis`](https://recharts.github.io/en-US/api/XAxis/)。核对日期：2026-07-24。

## 结论

“容器 + 声明式子组件”方向是对的，但当前方案只在外观上像 Recharts，核心组件词汇、嵌套层级和 prop 名都另造了一套。既然不承担兼容成本，应直接采用 Recharts 的 `LineChart` / `BarChart` / `ComposedChart`、`Line` / `Bar` / `Area` / `Scatter`、`XAxis` / `YAxis` 及其父子结构，仅把 `dataKey` 所代表的裸字段绑定替换或扩展为 niceeval 的 `Metric` / `Dimension` 绑定。

### 1. [P1] `ChartSeries as` 是对 Recharts series 组件的不必要再抽象

当前设计用一个 `<ChartSeries as="line" | "bar" | "area">` 合并 `<Line>`、`<Bar>`、`<Area>`，声称三者只差“怎么画”。

- 证据：`docs/roadmap/report-chart-composition/library.md:139`、`:160`
- Recharts：`ComposedChart` 的直接子组件就是独立的 `Line`、`Bar`、`Area` 和 `Scatter`。

这个合并损失了三类 series 各自的 props、子组件资格和 TypeScript 类型，并把本来由 JSX 元素名表达的类型退化成字符串判别字段。作者也无法直接迁移 Recharts 心智和示例。

建议删除 `ChartSeries`，直接提供：

```tsx
<ComposedChart>
  <Bar metric={costUSD} />
  <Line metric={endToEndPassRate} yAxisId="quality" />
</ComposedChart>
```

### 2. [P1] 容器继续叫 `MetricLine` / `MetricBars` / `MetricComposed` 没有收益

文档保留旧名字的唯一理由是它们已经导出、避免打散旧心智，但完整重构不受这个约束。

- 证据：`docs/roadmap/report-chart-composition/library.md:23`

新名字同时偏离 Recharts 的 `LineChart` / `BarChart` / `ComposedChart`，还出现单复数不一致的 `MetricLine` / `MetricBars`。如果目标是 Recharts-like，应直接使用 Recharts 容器名；niceeval 的领域属性由 `metric`、`dimension`、`input` 等 props 表达，不需要写进每个组件名。

### 3. [P1] `ErrorBar` 的父子关系与 Recharts 相反，也失去逐 series 控制

当前设计要求 `ErrorBar` 是图表容器的直接子节点，并对全部 series 生效。

- 证据：`docs/roadmap/report-chart-composition/library.md:182`
- Recharts：`ErrorBar` 消费 `Bar`、`Line` 或 `Scatter` 提供的 context，是 series 的子节点，不是 chart 的直接子节点。

当前形状无法表达“成本柱显示区间、通过率线不显示”或不同 series 使用不同区间口径。应与 Recharts 一样嵌套：

```tsx
<Bar metric={endToEndPassRate}>
  <ErrorBar kind="ci95" />
</Bar>
```

### 4. [P1] 不提供 `XAxis` / `YAxis`，导致多轴语法无法与 Recharts 同构

当前设计认为 Metric 和 NumericAxis 已自带轴信息，所以不提供轴子组件；双轴改成 series 上的 `yAxis="right"`。

- 证据：`docs/roadmap/report-chart-composition/library.md:141`、`:94`
- Recharts：轴由 `<XAxis>` / `<YAxis>` 显式声明，series 通过 `xAxisId` / `yAxisId` 绑定；右轴由 `<YAxis yAxisId="..." orientation="right" />` 表达。

Metric 可以提供单位、格式和方向的默认值，但不能替代轴作为一等结构：轴还承担 id、位置、domain、刻度和多个 series 的绑定。建议沿用 `XAxis` / `YAxis`，用 niceeval 字段补充数据语义：

```tsx
<ComposedChart>
  <XAxis dimension="agent" />
  <YAxis yAxisId="cost" metric={costUSD} />
  <YAxis yAxisId="quality" metric={endToEndPassRate} orientation="right" />
  <Bar metric={costUSD} yAxisId="cost" />
  <Line metric={endToEndPassRate} yAxisId="quality" />
</ComposedChart>
```

### 5. [P1] series 选择模型仍然不可计算

示例允许只写多个 `<ChartSeries value="...">`，同时省略 `series` / `by`。但 `value` 只是维度值，无法判断应该从 `agent`、`experiment` 还是 label 中取数。

- 证据：`docs/roadmap/report-chart-composition/library.md:33`、`:155`

无论最终采用 `<Line>` 还是 `<ChartSeries>`，动态展开都必须显式携带维度。可以让一个 series 组件通过 `by` 展开，也可以由 chart/axis 声明共享 series 维度，但 `value` 不能独立成为完整取数声明。

### 6. [P1] 排行版 `BarChart` 无法继续使用 `MatrixData`

提案允许排行形态省略 `columns`，却又声明仍产生完全相同的 `MatrixData`。

- 证据：`docs/roadmap/report-chart-composition/library.md:55`、`architecture.md:19`
- 既有数据形状：`docs/feature/reports/library/metric-views.md:41` 中 `MatrixData` 必须有 `columnDimension`，每个 cell 也必须有 `column`。

完整重构时不需要迁就旧 Data。排行条形图应有自己的 `BarChartData`，或者新图表家族统一采用真正能表达 category × series 的数据形状；不能虚构列来复用 `MatrixData`。

### 7. [P1] `ComposedData` 的 x 类型自相矛盾

注释称 `NumericAxis` 的 x 与 `LineData.x` 同形，实际却把所有 row 的 `x` 定义成 `string`，并缺少 `xDisplay`。

- 证据：`docs/roadmap/report-chart-composition/architecture.md:28`、`:36`
- 对照：`docs/feature/reports/library/metric-views.md:289` 中 `LineData.x` 是 `number | null`，另带本地化显示值。

维度轴和数值轴需要判别联合，或统一成保留原始值与显示值的轴数据结构。

### 8. [P2] 与 Recharts 同义的 props 被另行命名

当前方案使用 `stack` 和 `yAxis`；Recharts 对应名称是 `stackId` 和 `yAxisId`。`ChartSeries.label` 承担图例名，而 Recharts series 使用 `name`。

- 证据：`docs/roadmap/report-chart-composition/library.md:161`、`:163`、`:94`
- Recharts：`Line` / `Bar` / `Area` 公开 `xAxisId`、`yAxisId`、`name`；`Bar` / `Area` 使用 `stackId`。

这些概念语义相同，没有必要改名。应优先采用 Recharts 名称，只为 niceeval 独有概念增加新 prop。

### 9. [P2] 当前“直接子节点”模型无法承载 Recharts 的完整嵌套层级

Architecture 只允许结构描述节点作为 chart 的直接子节点，但 Recharts 至少还有：

- `ErrorBar` 属于 `Line` / `Bar` / `Scatter`。
- `LabelList` 可属于 series。
- `Cell` 可属于 `Bar` 等图形项。
- `Label` 可属于轴、参考标注或图形项。

- 证据：`docs/roadmap/report-chart-composition/architecture.md:10`

如果目标是尽量同构，结构描述节点应声明任意合法父组件关系，而不是只实现“chart 读取一层 children”的专用机制。否则后续每补一个 Recharts 能力都要再次修改节点架构。

### 10. [P2] web 自定义渲染与 text 投影的差异需要如实定义

`dot`、逐点 `label` 和 `Tooltip.content` 沿用 Recharts 的 ReactNode / render function 定制是合理的，但回调可以替换标签、数值或证据内容，不能继续笼统声称“两面同源不因自定义渲染破例”。

- 证据：`docs/roadmap/report-chart-composition/README.md:42`、`architecture.md:47`

应明确：数据与计算口径仍同源，但自定义 web presentation 不保证与默认 text presentation 内容等价；需要双面语义定制时，另提供同时返回 web/text 的 niceeval 扩展。

## 推荐的目标形状

优先做到“Recharts 组件树 + niceeval 数据绑定”，而不是“受 Recharts 启发的另一套组件树”：

```tsx
<ComposedChart input={scope}>
  <CartesianGrid />
  <XAxis dimension="experiment" />
  <YAxis yAxisId="cost" metric={costUSD} />
  <YAxis yAxisId="quality" metric={endToEndPassRate} orientation="right" />
  <Tooltip />
  <Legend />
  <Bar metric={plannerCostUSD} stackId="cost">
    <ErrorBar kind="ci95" />
  </Bar>
  <Bar metric={workerCostUSD} stackId="cost" />
  <Line metric={endToEndPassRate} yAxisId="quality" dot={false} />
  <ReferenceLine y={0.8} yAxisId="quality" label="目标" />
</ComposedChart>
```

无法完全照搬的地方应只限于数据语义：Recharts 的 `data` / `dataKey` 面向裸对象数组，niceeval 应支持 `input` / `metric` / `dimension` 并自动完成聚合与证据关联。组件名、嵌套关系以及 `name`、`stackId`、`xAxisId`、`yAxisId`、`orientation`、`dot`、`content` 等同义 props 没有偏离的必要。
