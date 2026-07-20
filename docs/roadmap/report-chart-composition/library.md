# Library 举例——现状写法 vs 候选写法

这篇逐场景对比[现状图表组件](../../feature/reports/library/metric-views.md)的扁平 props 写法与[候选 A](README.md#候选契约)的声明式子组件写法,给出每个场景下语法是否更短、表现力是否更强的具体结论——结论并不总是"候选更好",子组件语法只在特定场景下有真实收益,见文末[结论](#结论子组件语法的收益边界)。候选写法沿用[组件对照](component-mapping.md)定下的命名:`MetricLine`/`MetricBars` 保留现状名字只新增 children,`MetricComposed` 是唯一的新容器,`ChartSeries`/`Tooltip`/`Legend`/`CartesianGrid`/`ReferenceLine` 是子组件——这些都是本页用来举例的候选形状,不是定稿契约。

## 场景 1——单一 series 趋势图:候选没有优势

`MetricLine` 现状只有四个概念:x 轴、series 维度、y 指标、要不要连线;候选写法把 series 拆成子组件,反而多了一层嵌套:

```tsx
// 现状
<MetricLine x={budget} series="agent" y={endToEndPassRate} />
```

```tsx
// 候选 A:MetricLine 保留 x/y 容器 prop,series 维度降级成一个 by="agent" 的子节点
<MetricLine x={budget} y={endToEndPassRate}>
  <ChartSeries by="agent" />
</MetricLine>
```

**结论:** 现状一行四个 props 已经把这四个概念说清楚,候选写法要两层标签才能表达同一件事。这个场景下拆子组件没有换来任何新能力,只有更多样板——子组件语法的价值不在这里。

## 场景 2——逐 series 单独定制视觉:现状做不到

比较 baseline 与加了记忆机制的变体,要求两条线用不同线型区分(baseline 实线、变体虚线高亮),且给变体一个自定义图例名。现状 `MetricLineOptions` 没有"某个 series 值单独覆盖呈现"的入口——`series` 只是一个分组维度,`LineData` 不携带按 series 区分的呈现字段,要做这件事只能抛开 `MetricLine` 从零写自定义双面组件,连带丢失内置的两级指标聚合和两面同步:

```tsx
// 现状:MetricLine 不支持,只能整体放弃、自己写渲染
```

```tsx
// 候选 A:两个 series 都是字面量 value 声明(不是自动展开的 by),各带专属呈现 prop;
// 指标沿用容器级 y,不必在每个 ChartSeries 上重复
<MetricLine x={budget} y={endToEndPassRate}>
  <ChartSeries value="compare/baseline" label="baseline" />
  <ChartSeries value="compare/with-memory" label="+memory" strokeDasharray="4 2" />
</MetricLine>
```

**结论:** 这里候选语法不是"更简洁",是把现状**表达不了**的组合变成可表达——因为每个 series 现在是一个独立节点,可以各自携带专属 prop,不需要为"按 series 值覆盖呈现"在 `MetricLineOptions` 里发明一种新的嵌套选项(如 `seriesOverrides?: Record<string, {...}>`,这要求 series 取值在声明时就已知,与"`series` 从数据里发现取值域"的现状模型冲突)。这是真实的表现力提升。`value`(字面量单个 series)与场景 1 的 `by`(自动展开一个维度)是 `ChartSeries` 的两种互斥声明形态,详见[组件对照](component-mapping.md#chartseries-的两种声明形态)。

## 场景 3——同一张图混合柱与线:现状完全不可能

成本用柱状图、通过率用线,共享同一条 `agent` 轴画在同一张图里,不是上下两张图。现状 `MetricBars` 与 `MetricMatrix` 共享 `MatrixData`,但各自整张图渲染,没有"半张图柱、半张图线"的组合方式;[`ExperimentComparison`](../../feature/reports/library/summaries.md#experimentcomparison) 展示的是把多个独立组件按 `Col` 摞起来,是多张图并列,不是同一张画布内部混合:

```tsx
// 现状:没有对应组件,只能各自成图上下摆放
<Col>
  <MetricBars rows="agent" columns="eval" cell={costUSD} />
  <MetricLine x={budget} series="agent" y={endToEndPassRate} />
</Col>
```

```tsx
// 候选 A:新增的 MetricComposed 容器没有单一的容器级 y,
// 每个 ChartSeries 必须自带 metric——这是与场景 1/2 的 MetricLine 用法不同的地方
<MetricComposed x="agent">
  <ChartSeries as="bar" metric={costUSD} />
  <ChartSeries as="line" metric={endToEndPassRate} yAxis="right" />
</MetricComposed>
```

**结论:** 与场景 2 同类——不是语法偏好,是能力缺口的填补。现状拿不出"同一画布混合两种呈现"的等价物,候选写法把"呈现类型"变成子节点的一个属性(`as="bar"` / `as="line"`),新增第三种呈现类型时只是再加一个 `ChartSeries`,不用改动容器或其它子节点。`MetricComposed` 是[组件对照](component-mapping.md)里唯一新增的容器名字,其余场景都沿用现状的 `MetricLine`/`MetricBars`。

## 场景 4——加一条参考线标注:两种模型都能做,但扩展成本不同

在通过率趋势图上标一条"目标 80%"横线。现状指标组件里没有参考线概念,要做到只能自定义整个渲染;如果按现状模型补这个能力,得往 `MetricLineOptions` 继续加字段(如 `referenceLines?: Array<{ value: number; label?: string }>`),这是"给容器加一种子概念"的现状套路——可行,但每加一种新标注(参考线、参考区间、参考点)都要在同一个 options interface 里再加一个数组字段:

```tsx
// 现状:需要先给 MetricLineOptions 添加 referenceLines 字段(候选形状,现状未声明)
<MetricLine
  x={budget}
  series="agent"
  y={endToEndPassRate}
  referenceLines={[{ value: 0.8, label: "目标" }]}
/>
```

```tsx
// 候选 A:标注是新增的子组件类型,不改动已有的 ChartSeries
<MetricLine x={budget} y={endToEndPassRate}>
  <ChartSeries by="agent" />
  <ReferenceLine y={0.8} label="目标" />
</MetricLine>
```

**结论:** 两种模型都能达到目的,候选写法的优势是可维护性而非"能不能":新增一种标注是加一个独立子组件类型,不需要在已有容器的 options interface 里继续开洞;现状模型把所有附加能力都堆进同一个 interface,字段会越来越多。这条收益比场景 2/3 弱——它省的是未来维护成本,不是当下的表达能力。

## 场景 5——`MetricScatter`:不提案子组件化

`MetricScatter` 固定只有四个概念:点维度、series、x、y,x/y 两个指标对全部点共享、不会像 `MetricComposed` 那样出现"每个 series 各自不同指标"的诉求,也没有场景 2 那种"逐 series 覆盖呈现"的实际需要——[组件对照](component-mapping.md)因此没有给它设计对应的候选写法,现状保持不变:

```tsx
<MetricScatter points="experiment" series={label("line")} connect x={costUSD} y={endToEndPassRate} />
```

强行改写成子组件形式(如把 `x`/`y` 拆成两个 `ChartAxis` 子节点)只会比现状一行四个 props 更啰嗦,不会带来任何现状表达不了的组合,所以这不是候选 A 覆盖的范围——呼应下面的[结论](#结论子组件语法的收益边界)。

## 结论:子组件语法的收益边界

子组件语法的表现力提升集中在两类场景,不是全面替代现状:

- **同一张图需要混合多种呈现类型**(场景 3),或**同一组件需要逐值单独覆盖视觉**(场景 2)——这两类现状**做不到**,候选写法能表达;收益是真实的能力扩展,不是语法偏好。
- **给容器追加可选的附加标注**(场景 4)——两种模型都能做,候选写法把维护成本从"容器 options 持续开洞"换成"新增独立子组件类型",收益是长期可维护性。

对概念数量固定、不需要"任意混合多种呈现"或"逐值覆盖"的组件(`MetricTable`、`MetricScatter`、场景 1 的单 series `MetricLine`),候选写法只会让代码更长,没有表现力优势——现状的扁平 props 已经是这些场景下更短、更直接的表达。这意味着子组件语法不该覆盖 metric-views 全部组件,只该用在真正有"可插拔组合"诉求的图表族(`MetricLine`/`MetricMatrix`/`MetricBars` 这类随 series 数量和呈现类型增长的组件),呼应 [README 待裁决分歧](README.md#待裁决的分歧)里"多 series 类型混合是否是必须能力"这一条——本页场景 2/3 的结论是:对这部分组件,是必须能力,不是锦上添花。

## 相关阅读

- [图表组件的声明式子组件语法](README.md) —— 问题陈述、recharts 模型、兼容性分析与候选契约全文。
- [组件对照](component-mapping.md) —— 每个 recharts 组件原样借用、改名还是不借用,及 niceeval 新增的部分,本页命名的判定依据。
- [指标组件](../../feature/reports/library/metric-views.md) —— 现状组件的完整 props 契约与数据形状。
- [概览组件](../../feature/reports/library/summaries.md) —— `ExperimentComparison` 现状"多图并列"的组合方式。
