# Library:图表组件契约

候选图表 API 原样采用 Recharts 的容器、轴、series 和嵌套节点词汇,再用 niceeval 的 Metric、Dimension 与 `ReportInput` 替代裸对象 `data` / `dataKey` 取值。解析与 `ChartData` 见 [Architecture](architecture.md),真实图例见 [Gallery](gallery.md)。

## 容器

| 容器 | 直接 series 子节点 | 用途 |
|---|---|---|
| `LineChart` | `Line` | 数值参数趋势或维度折线 |
| `BarChart` | `Bar` | 排行、分组柱与堆叠柱 |
| `AreaChart` | `Area` | 强调累计量或区间的面积图 |
| `ScatterChart` | `Scatter` | 两个 Metric 的点云或前沿 |
| `ComposedChart` | `Line` / `Bar` / `Area` / `Scatter` | 同一坐标系混合多种 series |

容器共用下列公开形状:

```ts
interface ChartPresentationProps {
  width?: number | `${number}%`;
  height?: number;
  aspect?: number;
  layout?: "horizontal" | "vertical";
  margin?: Partial<{ top: number; right: number; bottom: number; left: number }>;
  locale?: ReportLocale;
  className?: string;
}

type ChartProps =
  | ({ data: ChartData; input?: never; evals?: never; children: ChartChild | readonly ChartChild[] } & ChartPresentationProps)
  | ({ input?: ReportInput; evals?: string | readonly string[]; data?: never; children: ChartChild | readonly ChartChild[] } & ChartPresentationProps);
```

`input` 省略时使用宿主注入的 Scope。容器 children 是唯一的轴、series 和局部 presentation 声明;不再提供 `rows` / `columns` / `cell` / `x` / `y` 扁平快捷 props。图表类型由 JSX 元素名表达,不再用字符串 `as`。

```tsx
<LineChart input={scope}>
  <XAxis numeric={budget} />
  <YAxis metric={endToEndPassRate} />
  <Line metric={endToEndPassRate} by="agent" />
</LineChart>
```

## 轴

### `XAxis`

spec 形态有三个互斥绑定:

```ts
type XAxisBinding =
  | { dimension: DimensionInput; numeric?: never; metric?: never; sort?: Metric }
  | { numeric: NumericAxis; dimension?: never; metric?: never; sort?: never }
  | { metric: Metric; dimension?: never; numeric?: never; sort?: never };

interface XAxisPresentationProps {
  xAxisId?: string | number;
  orientation?: "top" | "bottom";
  reversed?: boolean;
  domain?: readonly [number | "auto", number | "auto"];
  tick?: TickPresentation;
  label?: LabelPresentation;
}

type XAxisProps =
  | (XAxisBinding & XAxisPresentationProps)
  | ({ xAxisId: string | number; dimension?: never; numeric?: never; metric?: never; sort?: never } & XAxisPresentationProps);
```

- `dimension` 是分类轴,用于排行、分组柱或按离散配置比较。
- `numeric` 是 [`NumericAxis`](../../feature/reports/library/metrics.md#维度与数值轴),用于参数趋势;每个点保留数值原值和 `xDisplay` 等价显示值。
- `metric` 是散点图横轴;格式、bounds 与 `better` 来自 Metric。
- `sort` 只属于维度轴。它必须绑定图中一个已声明且有 `better` 的 Metric;方向跟随 `better`,同值以维度 key 稳定收口。

`xAxisId` 默认 `0`。`orientation`、`domain`、`tick` 和 `label` 沿用 Recharts 同义名称;niceeval 根据 Metric/NumericAxis 提供默认值,显式 props 覆盖 presentation,不改变聚合数据。

### `YAxis`

```ts
type YAxisBinding =
  | { metric: Metric; dimension?: never; sort?: never }
  | { dimension: DimensionInput; sort?: Metric; metric?: never };

interface YAxisPresentationProps {
  yAxisId?: string | number;
  orientation?: "left" | "right";
  reversed?: boolean;
  domain?: readonly [number | "auto", number | "auto"];
  tick?: TickPresentation;
  label?: LabelPresentation;
}

type YAxisProps =
  | (YAxisBinding & YAxisPresentationProps)
  | ({ yAxisId: string | number; dimension?: never; metric?: never; sort?: never } & YAxisPresentationProps);
```

`metric` 是数值轴的完整语义声明,不是可省略的格式提示。它提供 label、单位、bounds、显示格式与 `better`;`dimension` 用于 `BarChart layout="vertical"` 的纵向分类轴,`sort` 规则与维度 `XAxis` 相同。series 通过 `yAxisId` 显式绑定。双轴不再用 `yAxis="right"` 猜轴:

```tsx
<YAxis yAxisId="cost" metric={costUSD} />
<YAxis yAxisId="quality" metric={endToEndPassRate} orientation="right" />
<Bar metric={costUSD} yAxisId="cost" />
<Line metric={endToEndPassRate} yAxisId="quality" />
```

data 形态下轴绑定已经在 `ChartData` 中,`XAxis` / `YAxis` 只给对应 id 附加 presentation;不得再给 `dimension`、`numeric` 或 `metric`。

## Series

### 共用选择模型

`Line`、`Bar`、`Area` 共用两种 spec 形态:

```ts
type SeriesSelection =
  | { by?: never; value?: never }
  | { by: DimensionInput; value?: never }
  | { by: DimensionInput; value: string };

interface SeriesAxisBinding {
  xAxisId?: string | number;
  yAxisId?: string | number;
}

type MetricSeriesBinding =
  | ({ metric: Metric; dataKey?: string } & SeriesSelection & SeriesAxisBinding)
  | ({ dataKey: string; metric?: never; by?: never; value?: never } & SeriesAxisBinding);
```

- 不给 `by`:一个 Metric 形成一个 series。
- 只给 `by`:按该维度的已观测 domain 动态展开多个 series。
- 同给 `by` 与 `value`:精确选择这个维度值,适合逐 series 定制。

`value` 永远不能单独出现。若多个显式值需要相同默认 presentation,使用普通数组 map;不把一个动态 `by` 与若干 `value` 隐式合并成覆盖表。

`name` 是图例显示名,`xAxisId` / `yAxisId` 绑定显式轴。`dataKey` 只定义或选择解析后 series 身份,不是对象属性路径。spec 形态可以省略;data 形态必须提供且不能再给数据绑定字段。

动态 `by` 会解析成多个 dataKey,所以这种形态不能显式给单个 `dataKey`;无 `by` 或 `by + value` 恰好解析成一个 series 时才允许指定。

### `Line`

```ts
type LineProps = MetricSeriesBinding & {
  name?: LocalizedText;
  type?: "linear" | "monotone" | "step";
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  dot?: DotPresentation;
  activeDot?: DotPresentation;
  label?: LabelPresentation;
  connectNulls?: boolean;
};
```

`dot`、`activeDot` 与 `label` 沿用 Recharts 的定制阶梯。`connectNulls` 默认 `false`;开启时只跨缺失值连线,不会为缺失点制造 `MetricCell`。

### `Bar`

```ts
type BarProps = MetricSeriesBinding & {
  name?: LocalizedText;
  stackId?: string | number;
  fill?: string;
  stroke?: string;
  maxBarSize?: number;
  radius?: number | readonly [number, number, number, number];
  label?: LabelPresentation;
};
```

`stackId` 沿用 Recharts 名称。同一 stack 必须绑定同一对轴且 Metric 可相加;柱顶总值可用 `LabelList position="top" value="stackTotal"` 显式声明,不作为无法关闭的隐式装饰。

### `Area`

```ts
type AreaProps = MetricSeriesBinding & {
  name?: LocalizedText;
  stackId?: string | number;
  type?: "linear" | "monotone" | "step";
  stroke?: string;
  fill?: string;
  fillOpacity?: number;
  dot?: DotPresentation;
  label?: LabelPresentation;
  connectNulls?: boolean;
};
```

面积是独立 series 类型,不是 `LineChart area` 布尔开关;因此它保留自己的类型、props 与合法 children。

### `Scatter`

```ts
type ScatterBinding =
  | ({ points: DimensionInput; x: Metric; y: Metric; dataKey?: string } & SeriesSelection)
  | { dataKey: string; points?: never; x?: never; y?: never; by?: never; value?: never };

type ScatterProps = ScatterBinding & {
  name?: LocalizedText;
  xAxisId?: string | number;
  yAxisId?: string | number;
  line?: boolean | ScatterLinePresentation;
  shape?: ShapePresentation;
};
```

`points` 定义点身份,`by` 定义可选 series 维度。`line` 对应原 `connect`:开启后每个解析后 series 内按 x 原始值升序连线;text 面按同一顺序给逐段位移摘要。`x` / `y` 必须与所绑定的 Metric 轴一致。

```tsx
<ScatterChart>
  <XAxis metric={costUSD} />
  <YAxis metric={endToEndPassRate} />
  <Scatter points="experiment" by="agent" x={costUSD} y={endToEndPassRate} line />
</ScatterChart>
```

## 嵌套节点

| 节点 | 合法直接父节点 | 作用域 |
|---|---|---|
| `ErrorBar` | `Line` / `Bar` / `Scatter` | 只作用于父 series |
| `LabelList` | `Line` / `Bar` / `Area` / `Scatter` | 父 series 的每个图形项 |
| `Cell` | `Bar` / `Scatter` | 父 series 中匹配的一个或一组图形项 |
| `Label` | `XAxis` / `YAxis` / `ReferenceLine` / `ReferenceArea` / `ReferenceDot` | 父节点自己的标签 |

### `ErrorBar`

```ts
interface ErrorBarProps {
  kind?: "ci95" | "stderr";
  direction?: "x" | "y";
  stroke?: string;
  strokeWidth?: number;
}
```

`kind` 默认 `ci95`。`Line` / `Bar` 根据父 series 的 Metric 轴推定方向(常规布局是 y,横向 Bar 是 x);`Scatter` 必须显式选择 x 或 y,需要双轴误差时声明两个 `ErrorBar`。区间由父 series 对应 `MetricCell.samples` 计算,不收 Recharts 的裸字段 `dataKey`。

```tsx
<Bar metric={endToEndPassRate}>
  <ErrorBar kind="ci95" />
</Bar>
```

### `LabelList`

`LabelList` 使用 Recharts 的 `position`、`formatter` 与 `content`;默认值来自父 series 的 MetricCell。niceeval 增加 `value="stackTotal"`,只允许放在带 `stackId` 的 `Bar` / `Area` 下,表示同一 x 上该堆的可加总值。text 面把同一标签作为数值或图例附注输出。

### `Cell`

`Cell` 用来覆盖父 `Bar` / `Scatter` 的单项 presentation:

```ts
interface CellProps {
  value: string;
  dimension?: DimensionInput;
  fill?: string;
  stroke?: string;
  emphasis?: boolean;
}
```

`dimension` 省略时取父 `Bar` 的位置维度或父 `Scatter` 的 `points` 维度;无法唯一推定时要求显式给出。`value` 只在已知父数据边界内匹配图形项,不承担 series 取数。

### `Label`

`Label` 是轴或参考标注的标签子节点,支持 Recharts 的 `value`、`position`、`offset` 和 `content`。父 props 的短写 `label="..."` 与单个 `<Label value="..." />` 等价;两者同时给出时报错。

## 图表直接子节点

`CartesianGrid`、`Tooltip`、`Legend`、`ReferenceLine`、`ReferenceArea` 与 `ReferenceDot` 是所有 chart 容器的直接子节点。

- `CartesianGrid`:web 面网格;text 面无字符投影。
- `Tooltip`:web 面悬停显示轴值、Metric 显示值与证据;默认 text 面把同一证据放在图例/明细摘要,不存在悬停交互。
- `Legend`:两面使用同一已解析 series 顺序与 `name`;可用 `content` 定制。
- `ReferenceLine`:用 `x` 或 `y` + 对应 axis id 定位。
- `ReferenceArea`:用 `x1` / `x2` 或 `y1` / `y2` + axis id 定位。
- `ReferenceDot`:用 `x` / `y` + 两个 axis id 定位。

参考标注在 web 面画进坐标系;text 面以 label、坐标和值域列入图例区。没有 label 时仍输出机器可辨的默认说明。

## 呈现定制

适用位置沿用 Recharts 的阶梯:

```ts
type WebRenderer<Props> = ReactNode | ((props: Props) => ReactNode);
type TextRenderer<Props> = LocalizedText | ((props: Props) => LocalizedText);

type Presentation<Props, Defaults> =
  | false
  | Partial<Defaults>
  | WebRenderer<Props>
  | { web: WebRenderer<Props>; text: TextRenderer<Props> };
```

- `false`:关闭该 presentation。
- 部分属性对象:保留默认语义,只覆盖样式或位置。
- ReactNode / function:只接管 web 面;text 面继续默认投影,两面内容可能不同。
- `{ web, text }`:同时接管两面,用于标签、tooltip 或图例等有内容语义的定制。

渲染回调只收到解析后的只读 `ChartData` 片段和 presentation context,不能触发第二次聚合。

## Recharts 词汇的去向

| Recharts | 候选契约 |
|---|---|
| `LineChart` / `BarChart` / `AreaChart` / `ScatterChart` / `ComposedChart` | 原名采用 |
| `Line` / `Bar` / `Area` / `Scatter` | 原名采用,以 Metric/Dimension props 绑定数据 |
| `XAxis` / `YAxis` | 原名采用,增加 `dimension` / `numeric` / `metric` |
| `ErrorBar` / `LabelList` / `Cell` / `Label` | 原名及父子层级采用 |
| `CartesianGrid` / `Tooltip` / `Legend` / `Reference*` | 原名采用 |
| `dataKey` | 解析后 series 的稳定 id;不解析作者裸对象路径 |
| `stackId` / `xAxisId` / `yAxisId` / `name` / `orientation` | 原名采用 |
| `ResponsiveContainer` | 不提供;由 CSS 响应式承担 |
| `Brush` / `syncId` / 动画 / 鼠标事件全集 | 不提供;超出静态 HTML + 轻量渐进增强边界 |
| Polar、Pie、Radar、Funnel、Treemap、Sankey、Sunburst | 不提供;不落在配置 × 指标比较模型中 |

## 相关阅读

- [README](README.md) —— 问题、目标模型与边界。
- [Architecture](architecture.md) —— 解析、校验、计算规格与 `ChartData`。
- [Gallery](gallery.md) —— 真实报告图的结构验证。
- [指标与维度](../../feature/reports/library/metrics.md) —— Metric、Dimension 与 NumericAxis。
