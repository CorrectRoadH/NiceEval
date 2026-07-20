# 图表组件的声明式子组件语法

还没定为当前契约的候选设计,见 [Roadmap 约定](../README.md)。调研来源见 [References · Recharts](../../references.md#recharts)。语法与现状的逐组件对比举例见 [Library 举例](library.md)。

## 问题

[指标组件](../../feature/reports/library/metric-views.md)里图表形态的成员——`MetricMatrix`/`MetricBars`/`MetricScatter`/`MetricLine`——都是「一个组件、一份扁平 options」:坐标轴、图例、每个点的呈现、连线规则,全部是同一个组件上并列的 props 字段。这个形状有两处随图表能力增长而变差的地方:

- **新增一种呈现细节 = 给已有组件继续加字段。** `MetricScatter` 已经有 `points`/`series`/`x`/`y`/`connect`/`pointHref`/`locale`/`className` 八个 props;要支持"只给某个 series 换个形状标记"或"给某个点加参考线",目前只能继续在这一个组件上加字段,组件的 props 表没有天然的分区来承载这类局部定制。
- **同一张图没法混合两种呈现。** `MetricMatrix` 与 `MetricBars` 消费同一份 `MatrixData`,但二者是两个组件、渲染各自整张图;没有"同一张图里一部分行画成柱、一部分画成线"的组合方式——[`ExperimentComparison`](../../feature/reports/library/summaries.md#experimentcomparison) 展示的组合方式是把 `ScopeSummary`、`MetricScatter`、`ExperimentList` 三个独立组件按 `Col` 摞起来,是多张图/多个视图并列,不是同一张图内部的组合。

recharts 用"容器 + 声明式子组件"解决了同一类问题:图表家族里新增一种坐标轴、一种 series 类型、一种参考线,都是加一个子组件类型,不是给已有容器组件继续加字段;`ComposedChart` 允许 `Area`/`Bar`/`Line` 三种 series 组件混进同一个容器。这份文档评估这个模型能给 niceeval 图表组件借鉴到什么程度。

## 从 recharts 学到的模型

完整调研记录在 [References · Recharts](../../references.md#recharts),这里只重复与本设计直接相关的形状:

```tsx
<LineChart data={data} responsive>
  <CartesianGrid />
  <XAxis dataKey="name" />
  <YAxis />
  <Tooltip />
  <Legend />
  <Line dataKey="uv" stroke="var(--color-chart-1)" dot={{ fill: "..." }} />
  <Line dataKey="pv" stroke="var(--color-chart-2)" />
</LineChart>
```

- 容器(`LineChart`/`BarChart`/`ComposedChart`/…)只认领固定几个概念:数据源(`data`,一份对象数组)、尺寸与 margin。
- 子组件是声明式配置:坐标轴、网格、图例、tooltip 各是独立组件;每个 series 组件(`Line`/`Bar`/`Area`/`Scatter`)用 `dataKey` 从容器共享的 `data` 里取自己的字段。子组件之间不要求特定顺序。
- 同一个容器可以并列多种 series 组件类型(`ComposedChart` 里 `Area`+`Bar`+`Line`),新增一种呈现是加一个子组件类型,不改动容器或其它 series 组件。
- 定制阶梯是同一个类型公式贯穿多个定制点:`false`(关)→ `{ 部分属性对象 }`(轻量覆盖)→ `ReactNode | Function`(整体接管),如 `Line` 的 `dot`/`activeDot`/`label`/`shape`、`Tooltip` 的 `content`。

## 兼容性分析

### 能映射的部分

「子组件是配置,由容器解释」这个思路不需要引入运行时 context 就能落地:容器组件在自己的 `resolve` 阶段读取声明的直接子节点(它们只是携带 props 的描述,不需要独立取数),组装成传给现有 `metricScatterData`/`metricLineData`/`metricMatrixData` 的 options,产出与今天完全相同的 `ScatterData`/`LineData`/`MatrixData` 形状,两面渲染逻辑不用改。niceeval 已经有"子节点由特定父组件解释、不是通用两面组件"的先例:

- [`Tabs`/`Tab`](../../feature/reports/library/layout.md#tabs) 要求直接子节点必须是 `Tab`,由 `Tabs` 解释成分节而非独立渲染。
- [`Grid`](../../feature/reports/library/layout.md#grid-与-stat) 把每个直接子节点当不透明格子,不读取子节点内部结构。

图表容器要做的是同一类扩展,只是解释深度更深一层:不仅分组,还要从子节点的 props 里读出 `dataKey`、`metric`、`series` 之类的取数选项。

### 不能直接映射的部分

- **两面同源要求每个树节点都有 text/web 渲染资格。** [`ReportNode`](../../feature/reports/library/layout.md#树的节点reportnode) 的校验规则是"节点只有一类来源:`defineComponent` 产物或内置原语",且 `validate` 阶段确保展开后每个节点都有 text 和 web 两面。声明式子组件(如 `<ChartXAxis dataKey="agent" />`)本身不产出独立渲染——它是纯配置,不该被要求有自己的 text/web 面,也不该被通用 resolve 当成需要独立取数的组件展开。这意味着要把这类"结构描述子节点"当成 `ReportNode` 的一个新类别,豁免通用两面校验、只接受声明它的容器解释;这比 `Grid`/`Tabs` 现有先例（分组、不读取子节点 props)多一层扩展,是这份提案里最大的一处架构变化,需要单独裁决。
- **`ResponsiveContainer`/`responsive` 的测量机制不能照搬。** 已经在 [References · Recharts](../../references.md#recharts) 记为不采纳;niceeval 的响应式继续由 CSS Grid + container query 承担,不引入 `ResizeObserver`。
- **text 面没有对应物,不因语法变化而减少工作量。** `MetricScatter`/`MetricLine` 已有的字符坐标图/位移摘要是 niceeval 自己的实现,与是否采用 recharts 式子组件语法无关——无论选下面哪个候选,text 面的 ASCII 渲染都要照常维护。

## 候选契约

### 候选 A——语法糖:自研描述性子组件,不依赖 recharts 包

新增一组只携带配置、不产出独立渲染的子组件(如 `ChartXAxis`、`ChartSeries`、`ChartTooltip`、`ChartLegend`),容器组件(如 `MetricChart`)在 `resolve` 阶段读取这些直接子节点的 props,组装成选项后调用既有的 `*Data` 函数:

```tsx
<MetricChart type="line" x={budget}>
  <ChartSeries dataKey="agent" metric={endToEndPassRate} />
  <ChartTooltip />
</MetricChart>
```

产出的数据形状与今天的 `MetricLine` 一致,两面渲染完全自研,不引入 `recharts` 依赖。代价是需要在 `ReportNode` 里落地"结构描述子节点"这个新类别(见上一节的不兼容点),影响 resolve/validate 的通用规则。

### 候选 B——recharts 仅作 web 面的构建期 SVG 生成器

作者书写的语法(不论是候选 A 的子组件形式还是维持现在的扁平 props)不变;容器组件的 `web()` 渲染面在内部用 `recharts` 的组件生成静态 SVG 字符串(如 `renderToStaticMarkup`),但显式传入固定 `viewBox` 与尺寸,不使用 `ResponsiveContainer`/`responsive` 的 `ResizeObserver` 测量——响应式改用 SVG 自身的 `viewBox` + CSS `width: 100%` 完成,这与 niceeval 现有"响应式由 CSS 完成"的原则一致,不依赖 JS 测量。这条路径把 recharts 仅当成"坐标轴刻度计算 + 曲线插值 + SVG 几何"的实现细节,复用其成熟的图形计算,不把 recharts 的组件语法或 context 机制暴露给报告作者。text 面仍然完全自研。需要确认的技术前提:recharts 的图形计算部分(scale、曲线插值、tick 生成)是否能在固定 viewBox 下产出确定结果而不依赖浏览器测量 API——如果做不到,这条候选不成立。

### 候选 C——保留扁平 props,只借「定制阶梯」

不引入子组件语法,不碰 `ReportNode` 的节点类别。只给现有图表组件加一层可选的定制阶梯:关键呈现点(如 `MetricScatter` 的点标记、`MetricLine` 的线型)从"只有呈现 prop"升级成"`false | { 部分呈现属性 } | 渲染函数`"三态,渲染函数收到的是该组件已解析出的单点/单 series 数据(而不是整棵子树)。不解决"同一张图混合多种 series 类型"的诉求,但改动范围最小,不需要新的树节点类别,可以先落地评估价值。

## 待裁决的分歧

- 是否值得为图表类组件引入"结构描述子节点、豁免两面校验"这个新的 `ReportNode` 类别(候选 A 的前提),还是先从候选 C 起步、把子组件语法的架构改动推迟到确认收益之后?
- 候选 B 的技术前提——recharts 的坐标轴/曲线计算能否在固定 viewBox、无浏览器测量的环境下产出确定输出——需要先验证再决定要不要把它列为可行候选。
- 若采用候选 A,子组件的命名要不要直接照抄 recharts(`XAxis`/`Line`/`Bar`),换取用户心智迁移成本更低;还是用 niceeval 自己的词汇(`ChartXAxis`/`ChartSeries`),避免用户误以为可以直接传 `recharts` 的完整 props 表或和真实 recharts 包换用。
- `ComposedChart` 式的多 series 类型混合是否是必须能力,还是现状"`MetricMatrix`/`MetricBars` 复用同一份 `MatrixData`、`ExperimentComparison` 把多个独立图表摞在一起"已经覆盖了实际场景,不值得为混合单图引入架构改动。

## 相关阅读

- [Library 举例](library.md) —— 逐组件对比现状写法与候选新写法,评估语法与表现力的实际提升。
- [References · Recharts](../../references.md#recharts) —— 调研原始记录:是什么、值得抄什么、不抄什么及理由。
- [指标组件](../../feature/reports/library/metric-views.md) —— 现有图表组件的扁平 props 契约。
- [排版原语与自定义组件](../../feature/reports/library/layout.md) —— `ReportNode`、`Grid`/`Tabs` 的子节点解释先例、`defineComponent` 两种形态。
- [Architecture · 组件模型](../../feature/reports/architecture.md#组件模型解析面与渲染面) —— resolve/validate/render 管线与两面同源的不变量。
