# Architecture:组件树解析与图表数据

本篇定义 [README](README.md) 候选组件树怎样进入 Reports 的 resolve/validate/render 管线,以及图表计算函数产生的可序列化数据形状。逐组件公开语法见 [Library](library.md)。

## 结构树,而不是一层 `children`

图表声明节点是一类只携带 props 的结构节点。它没有独立 text/web 渲染面,由最近的合法拥有者解释。结构节点可以递归嵌套;每个节点类型声明合法父组件集合,而不是统一要求成为 chart 的直接子节点。

解析器保留 JSX 中的所有权关系:

1. chart 收集直接子节点里的轴、series、网格、图例、tooltip 与参考标注。
2. series 收集自己的 `ErrorBar`、`LabelList` 与 `Cell`;轴和参考标注收集自己的 `Label`。
3. 每个结构节点在原位置验证父类型。合法类型放错层级时,错误同时给出收到的父类型、允许的父类型和可复制的正确嵌套示例。
4. 容器把计算字段归一成 `ChartSpec`,调用 `chartData(input, spec)`;presentation 字段保留在结构树上,不写进 Data。
5. text/web renderer 消费同一份 `ChartData` 和同一棵已验证结构树,分别投影 presentation。

`Tabs` / `Tab` 已经提供“子节点由特定父组件解释”的先例;图表树只是把这个机制推广为可递归、可声明宿主集合的结构节点类别。通用 `ReportNode` 校验仍要求最终可渲染节点有两面;被宿主消费的结构节点不作为独立渲染节点进入该检查。

## 绑定与展开

一张图先由 `XAxis` 确立横轴来源,再由 series 声明取数口径:

- `Line` / `Bar` / `Area` 的一个解析后 series = 一个 Metric + 可选的 `(by dimension, value)`。
- `Scatter` 的一个解析后 series = points dimension + x/y Metric + 可选的 `(by dimension, value)`。
- 未给 `by` 时,组件产生一个 series;给 `by` 且未给 `value` 时,按该维度已观测 domain 展开;同时给 `by` 与 `value` 时只选择该精确值。
- `value` 没有 `by`、值不在 `by` 的 domain、同一 `(component, by, value)` 重复声明,都以完整用户反馈失败。`value` 从不猜它属于 agent、experiment 还是 label。

同一 metric 可以用一个动态声明展开,也可以用多个显式声明逐值定制:

```tsx
<Line metric={endToEndPassRate} by="agent" />

<Line metric={endToEndPassRate} by="agent" value="baseline" name="baseline" />
<Line
  metric={endToEndPassRate}
  by="agent"
  value="with-memory"
  name="+memory"
  strokeDasharray="4 2"
/>
```

两个形态是互斥的完整 series 集合,不做“一个 `by` 兜底,若干 `value` 再覆盖”的隐式合并。需要共享默认值时用普通 JSX map 或对象展开;这让每个声明对应哪批数据保持局部可读。

## 轴引用与兼容性

轴 id 使用与 Recharts 相同的 `xAxisId` / `yAxisId`;省略时引用 id `0`。每个引用必须恰好命中一个同向轴。

- 维度 `XAxis` 可承载 `Line` / `Bar` / `Area`;数值 `XAxis` 可承载趋势 series;Metric `XAxis` 承载 `Scatter` 的 x 值。
- Metric 轴定义 label、单位、格式、bounds 与 `better`;分配到该轴的 series metric 必须与其单位、格式、bounds 和方向兼容。常规布局的 Metric 轴是 Y,`BarChart layout="vertical"` 的 Metric 轴是 X。
- `Scatter.x` / `Scatter.y` 必须分别与所绑定 X/Y 轴的 Metric 相同。其它 series 的 `metric` 必须与 Y 轴 Metric 相同,或通过 Metric 的显式轴兼容声明证明同单位同尺度。
- 同一个 `stackId` 只允许绑定同一对轴的 `Bar` / `Area`;堆中指标必须可相加。字符串恰好相同不能越过单位或尺度校验。

多轴、右轴与堆叠因此都是显式结构,不从 series 集合猜测:

```tsx
<YAxis yAxisId="cost" metric={costUSD} />
<YAxis yAxisId="quality" metric={endToEndPassRate} orientation="right" />
<Bar metric={plannerCostUSD} yAxisId="cost" stackId="cost" />
<Line metric={endToEndPassRate} yAxisId="quality" />
```

## 计算规格

JSX spec 形态与手工计算形态归一到同一个可序列化规格。presentation props 不属于这些类型:

```ts
type AxisId = string | number;

type XAxisSpec =
  | { xAxisId?: AxisId; dimension: DimensionInput; sort?: Metric; numeric?: never; metric?: never }
  | { xAxisId?: AxisId; numeric: NumericAxis; dimension?: never; metric?: never }
  | { xAxisId?: AxisId; metric: Metric; dimension?: never; numeric?: never };

type YAxisSpec =
  | { yAxisId?: AxisId; dimension: DimensionInput; sort?: Metric; metric?: never }
  | { yAxisId?: AxisId; metric: Metric; dimension?: never; sort?: never };

type MetricSeriesSpec = {
  dataKey?: string;
  metric: Metric;
  by?: DimensionInput;
  value?: string;
  xAxisId?: AxisId;
  yAxisId?: AxisId;
};

type ScatterSeriesSpec = {
  dataKey?: string;
  points: DimensionInput;
  x: Metric;
  y: Metric;
  by?: DimensionInput;
  value?: string;
  xAxisId?: AxisId;
  yAxisId?: AxisId;
};

interface ChartSpec {
  evals?: string | readonly string[];
  xAxes: readonly XAxisSpec[];
  yAxes: readonly YAxisSpec[];
  series: readonly (MetricSeriesSpec | ScatterSeriesSpec)[];
}

function chartData(input: ReportInput, spec: ChartSpec): Promise<ChartData>;
```

`dataKey` 是解析后 series 的稳定身份,不是从裸对象取值的路径。省略时由绑定种类、Metric key、`by` dimension/value 与轴 id 确定性生成;显式值在同一 chart 内必须唯一。它使 `data` 形态可以用 Recharts 熟悉的 `dataKey` 对某个已计算 series 应用 presentation,不会重新取数。

## `ChartData`

排行条形、维度柱线图、数值趋势和散点使用一份真正覆盖 category × series 的数据模型。它不复用要求 `columnDimension` 的 `MatrixData`,也不把维度 key 与数值 x 压成同一个 `string` 字段。

```ts
type AxisId = string | number;

type XAxisData =
  | {
      kind: "dimension";
      xAxisId: AxisId;
      dimension: string;
      values: Array<{ key: string; value: string; display: LocalizedText }>;
    }
  | {
      kind: "numeric";
      xAxisId: AxisId;
      key: string;
      label: LocalizedText;
      unit?: string;
      values: Array<{
        key: string;
        value: number | null;
        display: LocalizedText;
      }>;
    }
  | {
      kind: "metric";
      xAxisId: AxisId;
      metric: MetricColumn;
    };

type YAxisData =
  | {
      kind: "dimension";
      yAxisId: AxisId;
      dimension: string;
      values: Array<{ key: string; value: string; display: LocalizedText }>;
    }
  | {
      kind: "metric";
      yAxisId: AxisId;
      metric: MetricColumn;
    };

type ChartSeriesData =
  | {
      kind: "metric";
      dataKey: string;
      metric: MetricColumn;
      byDimension?: string;
      byValue?: string;
      xAxisId: AxisId;
      yAxisId: AxisId;
      /** 引用该 series 唯一的 dimension/numeric 位置轴值。 */
      rows: Array<{ key: string; axisValueKey: string; cell: MetricCell }>;
    }
  | {
      kind: "scatter";
      dataKey: string;
      pointDimension: string;
      byDimension?: string;
      byValue?: string;
      xAxisId: AxisId;
      yAxisId: AxisId;
      x: MetricColumn;
      y: MetricColumn;
      rows: Array<{ key: string; x: MetricCell; y: MetricCell }>;
    };

interface ChartData {
  xAxes: XAxisData[];
  yAxes: YAxisData[];
  series: ChartSeriesData[];
}
```

维度和数值位置轴的原始值、稳定 key 与本地化显示值各有独立字段。metric series 的 `axisValueKey` 必须命中它所绑定的唯一 dimension/numeric 轴值:常规布局是 X 轴,横向 Bar 是 Y 轴;另一个轴必须是兼容的 Metric 轴。scatter 的 x/y 值直接携带 `MetricCell`,因为两轴都需要样本和证据。`Line`、`Bar` 与 `Area` 是同一份 metric series 数据的三种 presentation,不写入 Data;`stackId`、颜色、线型、标签和误差口径也留在结构树中。

纵向排行是 dimension X 轴 + Metric Y 轴;横向排行是 Metric X 轴 + dimension Y 轴。维度轴的 `sort` 在聚合后稳定排列 axis values,同值以 key 收口。两者都不制造虚假的 column dimension。

## spec / data 两种形态

spec 形态由容器的 `input` 与带数据绑定的结构子节点计算 `ChartData`。data 形态接收 `data={ChartData}`,不再取数:

- data 形态的 `XAxis` / `YAxis` 只用 id 选择已有轴并追加 presentation。
- data 形态的 `Line` / `Bar` / `Area` / `Scatter` 必须用 `dataKey` 选择已有 series;`metric`、`points`、`x`、`y`、`by`、`value` 禁止出现。
- data 形态中每个要绘制的 series 必须由一个同 kind 的 series 节点引用;`ChartData` 不记录它应画成 line、bar、area 还是 scatter。没有被引用的数据可以留作调用方主动隐藏的 series,重复引用同一个 `dataKey` 则报错。
- `ErrorBar`、`LabelList`、`Cell`、参考标注等 presentation 节点在两种形态下相同。
- 同时给 `data` 与 `input` 或任何计算绑定字段时,以完整用户反馈失败。

这保留 [`niceeval/report/react`](../../feature/reports/library/metric-views.md#共用数据形状) 所需的纯数据入口,又不让裸 `value` 或对象字段路径混回 spec 语义。

## 聚合与双面不变量

每个 series 桶内仍先按 experiment × eval 使用 Metric 的 `perEval`,再跨 eval 使用 `acrossEvals`;所有 `MetricCell` 保留 `samples` / `refs`。排序、缺失值、轴 domain、`better` 方向与证据顺序只计算一次,两面共用。

web render function 属于 presentation,可以故意改变可见内容。默认 text 投影仍读取原始 `ChartData`;只有作者提供 `{ web, text }` 双面定制时才替换 text 内容。这个边界保证计算同源,不对任意 React 回调承诺无法验证的内容等价。

## 不引入的机制

- 不引入 Recharts 运行时或 React context;组件树词汇同构不意味着渲染实现相同。
- 不引入 `ResizeObserver`;响应式由静态 HTML 的 CSS Grid 和 container query 承担。
- 不让结构节点独立取数;所有读取与聚合仍由 chart 的一次 resolve 完成并记忆化。
