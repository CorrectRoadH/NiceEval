# 指标组件

把 [指标](metrics.md) 投影成榜单、矩阵、条形、散点、趋势与差异表。每个组件的 props 由**数据来源**与**呈现选项**组成，数据来源二选一（模型见 [Architecture · 组件模型](../architecture.md#组件模型解析面与渲染面)）：

```tsx
// spec 形态：计算选项直接作为 props，input 省略时取宿主注入的 Scope
<MetricTable rows="agent" columns={[endToEndPassRate, costUSD]} filter />

// data 形态：接收配套 *Data 函数算好的数据
<MetricTable data={await metricTableData(scope, options)} filter />
```

统一的组合规则，本页各组件不逐个重复：

```ts
type DataProps<Data, Options, Presentation> =
  | ({ data: Data } & Presentation)
  | ({ input?: ReportInput } & Options & Presentation);
```

spec 形态与「先手工调 `*Data` 再传 `data`」严格等价；同一组件同时给出 `data` 与 spec 字段按完整用户反馈报错。所有计算函数的第一参数都是 [`ReportInput`](metrics.md#公开计算模型)；所有 data 都是可序列化普通数据。`niceeval/report/react` 入口的同名组件只有 data 形态。

`evals` 是各组件唯一的数据过滤选项：eval id 前缀，与 CLI 位置参数同语义，在聚合**之前**收窄题集——聚合发生在计算函数内部，事后 JavaScript 无法从聚合值还原题级过滤，所以它必须是选项。逐实体成行的[实体列表](entity-lists.md)不设它：列表数据的聚合边界就是单实体，取数后用普通 JavaScript 过滤与任何选项严格等价。

数组顺序只有两类：`questions`、`pairs`、`metrics` 等作者显式传入的列表保留声明顺序；从数据发现的维度 domain 按稳定 key 字典序。组件级 `sort` 是稳定排序，同值时仍以 key 收口。这个规则适用于 text、web 和写出的 JSON，不让文件扫描顺序渗进报告。

## 共用数据形状

数据形状的字段命名只有一条规则：**维度名字段 = 产生它的选项名 + `Dimension` 后缀**（`rows` → `rowDimension`、`points` → `pointDimension`、`by` → `byDimension`），值是解析后的维度 name；条目数组一律叫 `rows`，Matrix 的稀疏格子叫 `cells`。条目内的 `key` / `series` 是维度**值**，不带后缀。

```ts
interface TableData {
  rowDimension: string;
  columns: MetricColumn[];
  rows: Array<{
    key: string;
    cells: Record<string, MetricCell>;
  }>;
}

interface MatrixData {
  rowDimension: string;
  columnDimension: string;
  metric: MetricColumn;
  /** 稀疏格子：没有 attempt 的组合不生成格子。 */
  cells: Array<{ row: string; column: string; cell: MetricCell }>;
}

interface ScatterData {
  pointDimension: string;
  seriesDimension?: string;
  x: MetricColumn;
  y: MetricColumn;
  rows: Array<{
    key: string;
    series?: string;
    x: MetricCell;
    y: MetricCell;
  }>;
}
```

## `MetricTable`

一行一个维度值，一列一个指标。`sort` 决定初始顺序，方向由指标的 `better` 决定；`filter` 只给 web 面增加行过滤框。`sort` 必须是 `columns` 中同一个 Metric 实例且声明了 `better`，否则计算以完整用户反馈失败；省略时按行 key 字典序，避免为“更好”方向不明的指标猜顺序。

```ts
interface MetricTableOptions {
  rows: DimensionInput;
  columns: readonly [Metric, ...Metric[]];
  sort?: Metric;
  /** eval id 前缀；与 CLI 位置参数同语义。 */
  evals?: string | readonly string[];
}

function metricTableData(
  input: ReportInput,
  options: MetricTableOptions,
): Promise<TableData>;

type MetricTableProps = DataProps<TableData, MetricTableOptions, {
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<MetricTable
  rows="agent"
  columns={[endToEndPassRate, examScore, costUSD, durationMs]}
  sort={endToEndPassRate}
  evals="coding/"
  filter
/>
```

## `MetricMatrix` 与 `MetricBars`

二者使用同一份 `MatrixData`：Matrix 适合看“题 × 配置”的格子，Bars 适合比较每行的相对大小。

```ts
interface MetricMatrixOptions {
  rows: DimensionInput;
  columns: DimensionInput;
  cell: Metric;
  evals?: string | readonly string[];
}

function metricMatrixData(
  input: ReportInput,
  options: MetricMatrixOptions,
): Promise<MatrixData>;

type MetricMatrixProps = DataProps<MatrixData, MetricMatrixOptions, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;

type MetricBarsProps = MetricMatrixProps;
```

```tsx
<MetricMatrix rows="eval" columns="agent" cell={endToEndPassRate} />
<MetricBars rows="eval" columns="agent" cell={endToEndPassRate} />
```

两个组件写同一份 spec 时，resolve 记忆化保证矩阵只计算一次——不需要为共享数据退回手工 `metricMatrixData`。矩阵是稀疏的：没有 attempt 的组合不生成格子。格子中的 `refs` 保留证据引用；在自有页面中传 `attemptHref` 可令格子跳到自己的 attempt 页。

## `Scoreboard`

Scoreboard 先接收一份显式固定题集，再把每个行维度在每道题上的分数折成总分和分科得分。组件不从已观测 attempt 的并集猜题集；因此“所有配置都没跑到的题”仍然留在分母中并按 0 分计。

```ts
interface ScoreboardOptions {
  rows: DimensionInput;
  /** 固定题集；eval id 必须唯一。元素引用运行时数据，类型放宽为普通数组，空数组在计算时按完整用户反馈报错。 */
  questions: readonly string[];
  /** 分科函数；默认与 evalGroup 维度同一条规则：取 eval id 的完整父路径，无 `/` 取完整 id。 */
  subject?: (evalId: string) => string;
  /** 权重按 eval id 前缀匹配，多个命中时最长前缀生效；默认 1。 */
  weights?: Readonly<Record<string, number>>;
  fullMarks?: number;
  score?: Metric;
}

interface ScoreboardData {
  rowDimension: string;
  questions: string[];
  fullMarks: number;
  weights: Array<{ prefix: string; weight: number }>;
  ignoredEvals: number;
  rows: Array<{
    key: string;
    total: {
      /** fullMarks × earned / possible。 */
      value: number;
      display: LocalizedText;
      /** 题集中该行完全没有 attempt 的题数。 */
      notRun: number;
      /** 有 attempt 但指标为 null（测不了）的题数。 */
      unscorable: number;
      refs: AttemptLocator[];
    };
    subjects: Array<{
      key: string;
      /** 加权后的 [0, 1] 题目分数之和。 */
      earned: number;
      /** 本分科题目的权重之和。 */
      possible: number;
      questions: number;
      notRun: number;
      unscorable: number;
      display: LocalizedText;
      refs: AttemptLocator[];
    }>;
  }>;
}

function scoreboardData(
  input: ReportInput,
  options: ScoreboardOptions,
): Promise<ScoreboardData>;

type ScoreboardProps = DataProps<ScoreboardData, ScoreboardOptions, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<Scoreboard
  rows="agent"
  questions={[
    "security/sql-injection",
    "security/path-traversal",
    "correctness/retry",
  ]}
  weights={{ "security/": 3, "correctness/": 2 }}
  fullMarks={100}
  score={examScore}
/>
```

`score` 默认是 `examScore`，每道题必须产出 `[0, 1]`；同一行中同一个 experiment × eval 的多轮先用该 Metric 的 `perEval` 聚合，同题横跨多个 experiment 时再用 `acrossEvals` 聚合。分数口径上，指标为 `null`（跑了但测不了）与完全未运行都按该题 0 分——固定题集的分母不缩水；但两者分开计数为 `unscorable` 与 `notRun`，成绩单能回答「这 0 分是没去考还是考了判不了」，渲染面把两个计数连同 `refs` 一起显示，不合并成一个笼统的缺失数。题目得分乘最长前缀命中的权重，未命中权重为 1；总分是 `fullMarks × earned / possible`，`fullMarks` 默认 100，分科显示 `earned / possible` 与同尺度百分比。

Scope 中存在题集之外的 eval 时，Scoreboard 忽略它们，把数量写进 `ignoredEvals` 并在注脚显示；`questions` 重复、空数组、空权重前缀、`fullMarks <= 0`、非正或非有限权重、score 超出 `[0, 1]`，或 `subject()` 返回空字符串时，计算以完整用户反馈失败，不产出歧义成绩单。

## `MetricScatter`

每个点是一个维度值，x / y 各一个指标，`series` 决定颜色和图例归类，默认不连线。`connect` 显式开启后，每个 series 内的点按 x 升序连成折线——只给「线 = 同族变体」的 lineage series 用：基线与加了某个机制的变体同线，连线显示位移。散点云之间没有天然顺序，对无关点连线只会画出虚构趋势；表达数值参数的进程用 `MetricLine`。

```ts
interface MetricScatterOptions {
  points: DimensionInput;
  /** 数组形态解析为复合维度，见指标与维度页。 */
  series?: SeriesInput;
  x: Metric;
  y: Metric;
  evals?: string | readonly string[];
}

function metricScatterData(
  input: ReportInput,
  options: MetricScatterOptions,
): Promise<ScatterData>;

type MetricScatterProps = DataProps<ScatterData, MetricScatterOptions, {
  /** series 内按 x 升序成线：web 面画折线，text 面在图例给逐段位移摘要；默认 false。连线是呈现，不改变 ScatterData。 */
  connect?: boolean;
  pointHref?: (row: ScatterData["rows"][number]) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />

// lineage 归类:同 line 值的实验一色成线,connect 连出基线 → 变体的位移
<MetricScatter points="experiment" series={label("line")} connect x={costUSD} y={endToEndPassRate} />

// 同一份 labels 声明横切:按记忆机制归类,跨 agent 比较机制本身
<MetricScatter points="experiment" series={label("memory")} x={costUSD} y={endToEndPassRate} />
```

**轴方向跟随指标的 `better`，「更好」恒指向右与上**：`better: "lower"` 的轴反向渲染（如成本轴左贵右便宜），`better: "higher"` 正向；角落提示因此恒为「越靠右上越好」。刻度标签始终显示真实值，反向只改方向不改数字；未声明 `better` 的轴正向渲染，且该图不出方向提示——组件不猜「更好」朝哪边。text 与 web 两面同一规则。

text 面是字符坐标图，web 面是 SVG，两面同一份数据与同一套顺序规则。点用标记字母 `A`、`B`、`C`… 标识，分配顺序即图例顺序：series 按显示键字典序，series 内按 x 原始值升序，无 series 时全部点按点维度键字典序。图例一行一个 series，行首是 series 显示键，后接该 series 各点的标记与 id。图表标题行尾显示归类维度（`· 按 line 归类`）。

`connect` 开启时，图例把 series 内各点以 ` → ` 串联（顺序同 x 升序），并为每段相邻点在下一行给出**位移摘要**——两轴指标的带符号差值（`通过率 +37.5pt · 成本 +$0.13`，`%` 的差是百分点、单位写 `pt`）；text 面不在坐标图里画折线，位移摘要就是线的 text 投影，web 面按同一顺序绘制折线。单点 series 无箭头无摘要。完整终端示例见 [`show` · 裸 show 的默认报告](../show/default-report.md)。

series 配色以稳定散列为起点（同键跨图同色）；同一张图内撞色时按图例顺序线性探测下一个空色格，键数超过色板才复用——跨图稳定让位给图内可辨。

x 或 y 缺失的点不绘制，并显示缺失数量。零个可画点时显示明确空态；只有一个可画点时照常画出。

web 面每个点都有直接标签。当点维度是 experiment 时，只有在当前 data 中末段唯一才缩成末段；发生重名时使用能区分它们的最短路径后缀，完整 id 与两轴值仍进 tooltip。标签布局保证不静默丢标签；冲突时使用 leader line 连回原点。

`MetricScatter` 是通用分析组件，直接消费调用方给出的 Scope，不根据 experiment id 隐式分区。默认 `ExperimentComparison` 也把宿主 Scope 原样交给它。

## `MetricLine`

`MetricLine` 只接受 [`NumericAxis`](metrics.md#维度与数值轴) 作为 x 轴，按 series 画指标趋势。字符串配置必须显式映射到数值；组件不猜 `low < medium < high`。

```ts
interface MetricLineOptions {
  x: NumericAxis;
  /** 数组形态解析为复合维度，见指标与维度页。 */
  series?: SeriesInput;
  y: Metric;
  evals?: string | readonly string[];
}

interface LineData {
  x: { key: string; label: LocalizedText; unit?: string };
  seriesDimension?: string;
  y: MetricColumn;
  rows: Array<{
    /** 点身份 = (series, x)：x 值的稳定十进制字符串，同一 series 内唯一。 */
    key: string;
    series?: string;
    x: number | null;
    xDisplay: LocalizedText;
    y: MetricCell;
  }>;
}

function metricLineData(
  input: ReportInput,
  options: MetricLineOptions,
): Promise<LineData>;

type MetricLineProps = DataProps<LineData, MetricLineOptions, {
  pointHref?: (row: LineData["rows"][number]) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
const budget = numericFlag("budget", { label: "Token budget", unit: "tokens" });
<MetricLine x={budget} series="agent" y={endToEndPassRate} />

// 一条线 = 一个 series 维值:同 (agent, memory) 的实验沿 budget 轴连成线
<MetricLine x={budget} series={["agent", label("memory")]} y={endToEndPassRate} />
```

点的身份模型是确定的：**一个点 = 一个 `(series, x)` 组合**。落进同一 `(series, x)` 桶的全部 attempt 先在各自 experiment × eval 内用 y 指标的 `perEval` 聚合，再用 `acrossEvals` 跨题折成该点唯一的 y 值——聚合顺序是 `(series, x, experiment, eval)`，同一桶里有多个 experiment 时它们合成一个点，不画垂直来回线。前提是 x 在同一 experiment × eval 内恒定：`numericFlag()` / `numericRunConfig()` 读 experiment 级配置，天然满足；自定义 `NumericAxis.of()` 若对同一 experiment × eval 的不同 attempt 返回不同值，计算以完整用户反馈失败——逐 attempt 变化的量是 y 指标的素材，不是参数轴。`x.of()` 返回 `null` 的 attempt 不伪造 x 值，组件报告未绘制数量。

## `DeltaTable`

`DeltaTable` 成对比较同一个显式维度上的 A 与 B。`by` 是必填，因此 `"baseline"` 不会被猜成 experiment、agent、flag 或 snapshot 中的某一种。`pairs` 有两种形态：**字面 pair 数组**逐对写死 A/B 与 label；**`pairsByFlag()` 派生声明**按一个 flag 机械导出全部 A/B 对——实验矩阵是「同配置开关某个 flag」时，配对关系本来就是 experiment 配置的推论，手抄 id 字面量等于把配置复写进报告，加实验后报告会静默缺行。

```ts
interface DeltaPair {
  label: LocalizedText;
  a: string;
  b: string;
}

/** 按 flag 派生 A/B 对；只在 by 为 "experiment" 时成立。 */
interface FlagPairs {
  readonly kind: "flagPairs";
  readonly flag: string;
  /** a 侧的 flag 取值；缺省表示「未声明该 flag」的实验作 a。 */
  readonly baseline?: JsonValue;
}

function pairsByFlag(name: string, options?: { baseline?: JsonValue }): FlagPairs;

interface DeltaTableOptions {
  by: DimensionInput;
  /** 字面 pair 需要自定义 label 时用；空数组在计算时按完整用户反馈报错。 */
  pairs: readonly DeltaPair[] | FlagPairs;
  metrics: readonly [Metric, ...Metric[]];
  evals?: string | readonly string[];
}

interface DeltaData {
  byDimension: string;
  columns: MetricColumn[];
  /** pairsByFlag 派生形态下的配对域实验数，0 对空态据此报「N 个实验、0 个可配对」；字面 pairs 不携带。 */
  experiments?: number;
  rows: Array<{
    key: string;
    /** 作者在 DeltaPair 里声明的 label，原样透传；renderer 据此显示行名。 */
    label: LocalizedText;
    a: { key: string };
    b: { key: string };
    cells: Record<string, {
      a: MetricCell;
      b: MetricCell;
      /** b.value - a.value；任一侧缺失则为 null。 */
      delta: number | null;
      display: LocalizedText;
      outcome: "improved" | "regressed" | "unchanged" | "unavailable";
    }>;
  }>;
}

function deltaTableData(
  input: ReportInput,
  options: DeltaTableOptions,
): Promise<DeltaData>;

type DeltaTableProps = DataProps<DeltaData, DeltaTableOptions, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
// 字面形态:逐对声明,label 自定义
<DeltaTable
  by="experiment"
  pairs={[{ label: "memory", a: "compare/baseline", b: "compare/with-memory" }]}
  metrics={[endToEndPassRate, costUSD, durationMs]}
/>

// 派生形态:按 flag 机械配对,加实验不用改报告
<DeltaTable
  by="experiment"
  pairs={pairsByFlag("memory")}
  metrics={[endToEndPassRate, costUSD, durationMs]}
/>
```

`pairsByFlag` 的配对规则是确定的：

- **配对域**：input 中的 experiment。两个 experiment 配对，当且仅当删除该 flag 后[可比性配置](../../results/library.md#官方现刻水位resultscurrent)深相等——输入范围就是配对边界，不再引入实验组规则。
- **a 与 b**：a 侧取 `baseline` 声明的 flag 值，缺省为「未声明该 flag」；b 侧该 flag 的每个其它取值各成一对。同配置不同 id 的实验各自成对，不合并。
- **label 自动生成**：`<a 的完整 experiment id> · <flag>=<b 值的稳定显示键>`；要自定义 label 就写字面 pairs，派生形态不收 label 覆盖。
- **排序**：按 (a 末段, flag 显示键) 字典序。
- **0 对不是错误**：收窄后配不出任何对时显示明确空态并报告「N 个实验、0 个可配对」；`by` 不是 `"experiment"` 时按完整用户反馈报错。

两种形态共同的行为：`a` / `b` 未命中时保留该 pair，对应侧格子为缺失；不把缺失当 0，不因一侧缺失把整行静默删掉。同一 `by` 值对应多个 experiment / snapshot 时，依然按通用两级指标口径聚合；需要一对一时选择更精确的维度。

字面形态的 `a` / `b` 与分组后得到的维度 key 精确匹配，不做前缀或模糊匹配；pair label 不得为空且在数组内唯一，`a === b` 直接报错。`metrics` 必须非空（元素是静态 import 的 Metric 实例，类型层用非空元组）；`pairs` 的元素引用运行时数据、常由过滤动态构造，类型放宽为普通数组，空数组在计算时按完整用户反馈报错。

## 相关阅读

- [指标与维度](metrics.md) —— 这些组件消费的指标、分组维度与数值轴。
- [概览组件](summaries.md) —— 默认报告怎样逐组组合散点与列表。
- [排版原语与自定义组件](layout.md) —— 把多个指标视图组织成报告树。
