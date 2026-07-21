# 组件对照——抄了什么、改了什么名、新增了什么

[候选 A](README.md#候选契约)的子组件不是照抄 recharts 的整套命名。这篇逐个交代每个 recharts 组件的去向:哪些原样借用、哪些改名或不借用及理由,再单独列出 recharts 没有对应物、niceeval 领域必须新增的部分。这篇的结论替换了 [README 待裁决分歧](README.md#待裁决的分歧)里"子组件命名要不要照抄 recharts"那一条——命名不是待裁决问题,而是每个组件按下面的理由逐个判定。

## 原样借用:名字与形状都不改

这几个组件是纯呈现,不绑定 `Metric` 或聚合语义,recharts 的 props 本身就是呈现参数,niceeval 没有理由造一个新名字:

| recharts 组件 | 用途 | niceeval 候选 |
|---|---|---|
| `CartesianGrid` | 背景网格线 | `CartesianGrid`,同名 |
| `Tooltip` | 悬停提示(web 渐进增强层) | `Tooltip`,同名 |
| `Legend` | 图例 | `Legend`,同名 |
| `ReferenceLine` | 参考线标注 | `ReferenceLine`,同名 |
| `ReferenceArea` | 参考区间标注 | `ReferenceArea`,同名 |

这五个都不出现在 niceeval 现有的导出命名里([排版原语](../../feature/reports/library/layout.md)的 `Table`、[指标组件](../../feature/reports/library/metric-views.md)的 `MetricTable` 等都不撞名),不需要加前缀区分。它们和 `Tab` 只能出现在 `Tabs` 下同理——通过父组件的结构校验约束用法,不用命名前缀表达从属关系。

## 改名或不借用:概念对不上 niceeval 的 Metric / Dimension 模型

| recharts 组件 | recharts 的绑定方式 | niceeval 候选处理 | 为什么 |
|---|---|---|---|
| `Line` / `Bar` / `Area` / `Scatter`(四个独立组件) | `dataKey: string`,从作者传入的原始对象数组里取一个字段;堆叠用 series 组件上的 `stackId` prop 表达 | 合并成一个 `ChartSeries`,`as="line" \| "bar" \| "area"` 选呈现;核心数据 prop 从 `dataKey` 换成 `metric: Metric`;`stackId` 以 `stack` prop 承接——同容器内 `stack` 值相同的 series 堆进同一根柱([真实图表对照 · 图 3](gallery.md#图-3成本构成堆叠条形)) | recharts 的 `dataKey` 假设作者随手传一个 JSON 数组、取字段名;niceeval 的 series 永远绑定一个 `Metric` 实例(带聚合口径、`better` 方向、单位),四个组件的真正差异只在"怎么画",不在"怎么取数"。拆成四个组件会让"新增一种画法"等价于"照抄一个新组件",合并成一个 `as` 属性才对应 niceeval 实际会变化的维度。 |
| `ErrorBar` | 子组件,`dataKey` 指向作者预先算好的误差值字段 | 同名 `ErrorBar`,但不收 `dataKey`:误差区间从该 series 聚合值已有的 attempt 级样本证据(`samples`/`refs`)计算,作者只选统计口径 | recharts 不知道数据从哪来,误差值只能作者自备;niceeval 的聚合值天然携带样本证据,让作者手工再算一遍置信区间等于把管线已有的信息复写进报告。用例见[真实图表对照 · 图 1](gallery.md#图-1单指标排行条形与置信区间)。 |
| `XAxis` / `YAxis` | 独立子组件,携带 `dataKey`、domain、tick 格式 | 不作为子组件出现,继续是容器/组件自身的 `x` / `y` prop(与今天 `MetricLine.x`、`MetricScatter.x`/`y` 一致) | recharts 需要独立轴组件,是因为它的 `data` 只是裸数组,tick 格式化、label、domain 全靠这个组件的 props 表达;niceeval 的 `NumericAxis` / `Metric` 对象本身已经携带这些字段([指标与维度](../../feature/reports/library/metrics.md)),再包一层 JSX 元素是纯重复,不是新增表达力。 |
| `LineChart` / `BarChart` / `AreaChart`(单一类型容器) | 容器名字直接等于图表类型 | 不改名:沿用既有 `MetricLine` / `MetricBars`,只给它们加"可选 children"这一能力 | 这两个名字已经是 niceeval 导出多年的定稿概念([指标组件](../../feature/reports/library/metric-views.md)),候选只扩展它们的组合能力,不该无故打散已有心智——[Library 举例](library.md)的场景 1、2、4 都基于这个决定。 |
| `ComposedChart`(混合类型容器) | 同一容器下并列多种 series 组件类型 | 新增 `MetricComposed` | niceeval 现状没有任何组件能表达"同一张图混合多种呈现类型"([Library 举例 · 场景 3](library.md#场景-3同一张图混合柱与线现状完全不可能)),这是唯一必须开一个新名字的场景,也是候选里唯一直接对应 recharts 概念的全新组件。 |
| `ResponsiveContainer` / 容器的 `responsive` 属性 | `ResizeObserver` 测量父元素 | 不借用 | 已在 [References · Recharts](../../references.md#recharts) 记为不采纳的技术原因(与「静态 HTML 先完整可读」的不变量冲突);niceeval 也没有对应的组件名字需要保留——响应式从来不是报告作者要显式声明的一个组件。 |

## `ChartSeries` 的两种声明形态

把 `Line`/`Bar`/`Area`/`Scatter` 合并进 `ChartSeries`之后,还要解决 recharts 没有的一个问题:recharts 的 series 组件永远是字面量声明(一个 `dataKey` 对应一条作者在写代码时就已知道的线),而 niceeval 的 series 常常要从数据里发现取值域(`series="agent"` 在 resolve 阶段才知道有哪些 agent)。`ChartSeries` 因此有两种互斥的声明形态,呼应现状 [`DeltaTable.pairs`](../../feature/reports/library/metric-views.md#deltatable) 字面量数组与 `pairsByFlag()` 派生声明并存的先例:

```tsx
// by:自动展开——按维度取值域,每个值各成一个 series,呈现取组件默认值
<ChartSeries by="agent" />

// value:字面量声明单个已知的 series,可以携带只属于它的呈现覆盖
<ChartSeries value="compare/baseline" label="baseline" />
<ChartSeries value="compare/with-memory" label="+memory" strokeDasharray="4 2" />
```

`by` 和 `value` 二选一,不共存于同一个 `ChartSeries`;两者也可以在同一个容器下混用——一个 `by="agent"` 兜底展开其余取值,若干 `value="..."` 单独覆盖已知的几个。这种"默认展开 + 显式覆盖同时出现时如何合并"的具体算法还没有定案,是这份提案里除[两面校验豁免](README.md#不能直接映射的部分)之外第二处需要单独设计的机制。

`ChartSeries` 的 `metric` prop 只在容器本身没有单一共享指标时才必填:`MetricLine`/`MetricBars` 保留容器级 `y: Metric`(与现状一致),这种情况下 `ChartSeries` 不重复声明 `metric`,只负责"这条线是谁、长什么样";`MetricComposed` 没有容器级 `y`(混合的意义就是每个 series 指标可能不同),`metric` 因此是它下面每个 `ChartSeries` 的必填项。

## 新增:recharts 没有对应物的部分

1. **Metric 绑定与两级聚合语义。** `Metric` 实例、`better` 方向、`perEval` / `acrossEvals` 两级聚合、`samples` / `total` / `refs` 覆盖率证据([Architecture · 指标聚合不变量](../../feature/reports/architecture.md#指标聚合不变量))——recharts 的每个数值只是原始对象里的一个字段,没有"这个数字怎么聚合出来""背后有多少条 attempt 证据"这类概念。
2. **spec / data 双形态。** 候选组件延续现状的 [`DataProps`](../../feature/reports/library/metric-views.md#共用数据形状):容器与 `ChartSeries` 都要同时支持"计算选项当 props"(spec,管线在 resolve 阶段代为取数)与"直接传算好的数据"(data,显式降级口)两种写法。recharts 只有"作者随手传数据数组"一种模式,没有框架自动调用取数函数这个中间层。
3. **text 面。** 每个候选组件必须同时产出终端 ASCII 投影(字符坐标图、位移摘要等),这在 recharts 里完全不存在——它只有浏览器 SVG 一种输出目标。
4. **`evals` 前缀过滤、`attemptHref` / `pointHref` 证据下钻链接。** 题集过滤在聚合之前收窄题集([指标组件](../../feature/reports/library/metric-views.md));点击一个点跳到对应 attempt 证据是类型化契约,不是通用鼠标事件——recharts 的 `onClick` 只是原始 DOM 事件回调,不提供"这个点对应哪条记录"的语义。
5. **`connect`——散点图内按 series 排序连线。** recharts 的 `Scatter` 从不连线、`Line` 总是连线,没有"可选连线的散点"这个概念;niceeval 用它表达 baseline → 变体的位移([`MetricScatter`](../../feature/reports/library/metric-views.md#metricscatter))。
6. **`better` 方向感知的坐标轴渲染。** "越靠右上越好"的自动翻转是 niceeval 领域特有的渲染规则,recharts 的 `XAxis` / `YAxis` 不知道"哪个方向更好"。
7. **`ChartSeries` 的 `by` / `value` 双形态。** 上一节已经展开:recharts 的 series 永远是字面量声明,"按维度自动展开出未知数量的 series"是 niceeval 需要新增的能力,recharts 没有对应物。
8. **`sort` 与 `MetricBars` 单维排行形态。** recharts 不排序——作者自备排好序的 `data` 数组即可;niceeval 的条形数据产自聚合管线,作者手里没有中间数组,排序必须是组件选项,语义沿用 [`MetricTable.sort`](../../feature/reports/library/metric-views.md#metrictable) 的 `better` 规则。`MetricBars` 省略 `columns` 的单维排行形态(一个维度值一根条)同属这次新增,动机见[真实图表对照 · 图 1](gallery.md#图-1单指标排行条形与置信区间)。

## 相关阅读

- [图表组件的声明式子组件语法](README.md) —— 问题陈述、recharts 模型、兼容性分析与候选契约全文。
- [Library 举例](library.md) —— 逐场景对比现状写法与候选写法,用的就是本页定下的命名。
- [真实图表对照](gallery.md) —— 四张真实报告图的结构对照;`ErrorBar`、`stack`、单维排行形态的动机来源。
- [References · Recharts](../../references.md#recharts) —— 调研原始记录。
- [指标组件](../../feature/reports/library/metric-views.md) —— 现状组件的完整 props 契约、`DataProps`、`DeltaTable.pairs` 字面量与派生声明并存的先例。
