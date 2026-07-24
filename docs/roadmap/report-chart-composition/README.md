# Recharts 组件树与 niceeval 数据绑定

这是尚未定为当前契约的候选设计,见 [Roadmap 约定](../README.md)。图表逐组件契约见 [Library](library.md),解析与数据模型见 [Architecture](architecture.md),真实报告图的结构验证见 [Gallery](gallery.md),调研来源见 [References · Recharts](../../references.md#recharts)。

## 问题

[指标组件](../../feature/reports/library/metric-views.md)里的 `MetricLine`、`MetricBars`、`MetricScatter` 以一个组件加一份扁平 options 表达整张图。这个模型能表达固定形态,但不能自然承载两类增长:

- 同一画布里混合柱、线、面积或散点,并让每个 series 独立选择轴、堆叠和误差呈现。
- 给轴、series 或单个图形项追加局部配置时,不持续给容器 options 增加字段或 `Record<string, ...>` 侧表。

Recharts 已经为这些关系建立了清晰词汇:图表容器持有共享上下文,轴与 series 是容器子节点,误差线和标签又属于具体 series。niceeval 没有理由另造一套外观相似的组件树;它真正需要增加的是 Metric、Dimension、聚合证据和 text/web 双面投影。

## 目标模型

候选 API 采用 **Recharts 组件树 + niceeval 数据绑定**:

```tsx
<ComposedChart input={scope}>
  <CartesianGrid />
  <XAxis dimension="experiment" />
  <YAxis yAxisId="cost" metric={costUSD} />
  <YAxis yAxisId="quality" metric={endToEndPassRate} orientation="right" />
  <Tooltip />
  <Legend />

  <Bar metric={plannerCostUSD} stackId="cost" yAxisId="cost">
    <ErrorBar kind="ci95" />
  </Bar>
  <Bar metric={workerCostUSD} stackId="cost" yAxisId="cost" />
  <Line metric={endToEndPassRate} yAxisId="quality" dot={false} />
  <ReferenceLine y={0.8} yAxisId="quality" label="目标" />
</ComposedChart>
```

组件名、父子关系以及 `name`、`stackId`、`xAxisId`、`yAxisId`、`orientation`、`dot`、`content` 等同义 props 沿用 Recharts。niceeval 只在数据语义上扩展它:

- 容器用 `input` 接收 `ReportInput`,不接收作者预聚合的裸对象数组。
- `XAxis` 用 `dimension`、`numeric` 或 `metric` 声明横轴来源;`YAxis` 用 `dimension` 或 `metric` 声明纵轴来源,从而覆盖横向排行。
- `Line`、`Bar`、`Area` 用 `metric` 绑定数值轴指标;`Scatter` 用 `points`、`x`、`y` 绑定点与两轴指标。
- series 需要按维度拆分时用 `by`;选择其中一个值时必须同时给 `by` 与 `value`,不允许脱离维度的裸 `value`。
- 聚合结果保留 `MetricCell.samples` / `refs`,由同一份 `ChartData` 驱动 text 与 web 两面。

## 容器与层级

候选图表族包含 `LineChart`、`BarChart`、`AreaChart`、`ScatterChart` 和 `ComposedChart`。这是一次完整 API 重构,不保留 `MetricLine` / `MetricBars` / `MetricScatter` / `MetricComposed` 别名或扁平写法。

结构节点遵循 Recharts 的所有权层级,不是只能被 chart 收集的一层列表:

```text
Chart
├── XAxis / YAxis
│   └── Label
├── Line / Bar / Area / Scatter
│   ├── ErrorBar
│   ├── LabelList
│   └── Cell
├── CartesianGrid / Tooltip / Legend
└── ReferenceLine / ReferenceArea / ReferenceDot
    └── Label
```

每类节点显式声明合法父组件集合。`ErrorBar` 因而只作用于自己的 series;`Cell` 只覆盖父 series 中匹配的图形项;轴 id 与 series 上的 `xAxisId` / `yAxisId` 形成可校验引用。完整宿主表见 [Library · 嵌套节点](library.md#嵌套节点),解析机制见 [Architecture · 结构树](architecture.md#结构树而不是一层-children)。

## 双面投影边界

数据、聚合口径、排序、轴值域与证据在 text/web 两面同源。默认 presentation 也有明确的两面投影:例如 web 的 tooltip 对应 text 的证据摘要,web 的误差须线对应 text 数值后的区间。

Recharts 风格的 `ReactNode | render function` 只接管 web presentation。回调可以替换标签、数值甚至证据内容,所以此时只保证底层 `ChartData` 同源,不保证自定义 web 内容与默认 text 内容等价。作者需要双面语义定制时,使用 `{ web, text }` 形态同时声明两面,精确类型见 [Library · 呈现定制](library.md#呈现定制)。

## 设计边界

- 两面渲染仍由 niceeval 实现,不把 Recharts 引入生成管线。静态 SVG、终端字符图、证据链接与无浏览器首屏仍属于 niceeval 的职责。
- `ResponsiveContainer`、动画、鼠标事件全集、`Brush` 与跨图 `syncId` 不进入契约;响应式继续由静态 HTML 的 CSS 布局承担。
- 饼图、雷达图、漏斗、树图、Sankey 等不落在“配置 × 指标”比较模型里的图型不因组件改名而进入范围。
- facet 继续使用 JSX `map` + `Grid`;组件树不重复实现语言已有的遍历能力。

## 相关阅读

- [Library](library.md) —— 容器、轴、series、嵌套节点与精确 props。
- [Architecture](architecture.md) —— 结构树解析、动态 series、`ChartData` 与双面边界。
- [Gallery](gallery.md) —— 四张真实报告图在候选 API 下的写法。
- [指标组件](../../feature/reports/library/metric-views.md) —— 当前已定稿图表契约,用于理解本 Roadmap 要替换的范围。
- [Reports Architecture](../../feature/reports/architecture.md) —— resolve/validate/render 管线与两面同源不变量。
