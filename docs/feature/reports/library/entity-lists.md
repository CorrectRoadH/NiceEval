# 实体列表

实体列表用于从汇总下钻到事实，不允许自由配置列。固定列不等于所有渲染面使用相同排版：web 面可以用表格支持人工比较，text 面可以用紧凑列表支持终端阅读，但两面必须消费同一份可序列化 `data`。计算函数分别是 `experimentListData`、`evalListData` 与 `attemptListData`；props 组合规则 `DataProps` 见[指标组件](metric-views.md)——spec 形态列出全量实体，要过滤或截断就在[组合组件](layout.md#自定义组件)里手工取数、用普通 JavaScript 加工后以 data 形态传入。列表数据逐实体成行，事后 JavaScript 过滤与任何选项严格等价，所以列表不设过滤选项；[指标组件的 `evals`](metric-views.md) 是聚合前收窄，属于另一类。

## 数据形状

```ts
interface AttemptListItem {
  experimentId: string;
  evalId: string;
  attempt: number;
  agent: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  /**
   * 该轮的单行结果摘要，已按 Scoring display 契约折好：failed 取主失败断言摘要，
   * errored 取结构化 error 的一层摘要（phase · code · message），passed / skipped 为 null。
   * 渲染面只做宽度截断，不重算摘要。
   */
  failureSummary: string | null;
  /** 主失败之外还有几条失败断言（"+N more failures" 的 N）；无失败为 0。 */
  moreFailures: number;
  /** 当前 attempt 的 examScore 与证据引用。 */
  examScore: MetricCell;
  durationMs: number;
  /** 缺失为 null（测不了），不伪造 0；attempt 级条目的缺失一律用 null，不用省略字段。 */
  costUSD: number | null;
  locator: AttemptLocator;
}

interface EvalListItem {
  experimentId: string;
  evalId: string;
  /** 任一轮 passed 即 passed，否则 failed > errored > skipped。 */
  verdict: "passed" | "failed" | "errored" | "skipped";
  examScore: MetricCell;
  durationMs: MetricCell;
  costUSD: MetricCell;
  attempts: AttemptListItem[];
}

interface ExperimentListEvalRow {
  evalId: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  durationMs: MetricCell;
  costUSD: MetricCell;
  attempts: AttemptListItem[];
}

interface ExperimentListItem {
  experimentId: string;
  agent: string;
  model?: string;
  flags?: Record<string, JsonValue>;
  /** eval 级最终 verdict 计票（Result 列的构成）。 */
  evalVerdicts: { passed: number; failed: number; errored: number; skipped: number };
  endToEndPassRate: MetricCell;
  costUSD: MetricCell;
  durationMs: MetricCell;
  tokens: MetricCell;
  evals: number;
  attempts: number;
  lastRunAt: string;
  evalRows: ExperimentListEvalRow[];
}

function experimentListData(input: ReportInput): Promise<ExperimentListItem[]>;

function evalListData(input: ReportInput): Promise<EvalListItem[]>;

function attemptListData(input: ReportInput): Promise<AttemptListItem[]>;

// 实体列表没有计算选项(见开篇:过滤、截断都是取数后的普通 JavaScript),DataProps 的 Options 腿为空。
type ExperimentListProps = DataProps<readonly ExperimentListItem[], {}, {
  filter?: boolean;
  relativeTo?: string;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;

type EvalListProps = DataProps<readonly EvalListItem[], {}, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;

type AttemptListProps = DataProps<readonly AttemptListItem[], {}, {
  /** 过滤 / 截断前的总数；省略时等于 data 长度。 */
  total?: number;
  /** web 面加过滤输入框（按 experiment、eval、agent、verdict 或摘要文本收窄行）；渐进增强，不改变数据与 text 面。 */
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

## `ExperimentList`

每项显示 experiment 身份、agent / model、flags、判定构成、官方指标和其中的 eval。组件不推断分组；默认 `ExperimentComparison` 把当前 Scope 的全部 items 交给它。

一行只有一套 `agent / model / flags`，这不是显示上的取舍而是输入约束：宿主注入的 [`current()` Scope 保证每个 experiment 只由可比性配置一致的快照拼成](../../results/library.md#官方现刻水位resultscurrent)；作者自选 `Snapshot[]` 时若同一 experiment 混入不一致的可比性配置，`experimentListData` 按完整用户反馈失败并指引——看跨配置演化用 `snapshot` 维度或 [`MetricLine`](metric-views.md#metricline)，不把两套配置拼成一行冒充单一配置。

web 面是固定列的 experiment 比较表，而不是无表头的松散卡片列表。主表一行一个 experiment，列顺序固定为：

| 列 | 内容 |
|---|---|
| Experiment | experiment id；副行以“`8 evals` / `8 个 Eval`”显示 eval 数，attempt 数多于 eval 数时再显示 attempt 数，最后跟最后运行时间；不把 Eval 翻成“题”。传 `relativeTo` 时行标签去掉该路径前缀；完整 id 仍用于排序键、过滤和折叠展开 |
| Model | model；缺失时显示明确空值 |
| Agent | agent |
| Avg. time | 官方 `durationMs` 聚合值；中文列名为“平均耗时” |
| Pass rate | 官方 `endToEndPassRate` 聚合值；中文列名为“通过率”，默认按此列从高到低排序 |
| Tokens | 官方 `tokens` 聚合值 |
| Cost | 官方 `costUSD` 聚合值；实测成本优先、估算兜底，列头不断言口径 |
| Results | passed / failed / errored / skipped 的 eval 级判定构成，各项以中点分隔，不渲染成类似按钮的胶囊 |

表头支持点击排序；标签和排序箭头作为一个不换行的单元对齐，当前排序方向始终可见，其余列的排序提示只在 hover / focus 时显示。宽度不足时整表横向滚动，不把标签与箭头拆成两行。`filter` 为 web 面增加过滤输入框，可按 experiment、agent、model、flag 或 eval 文本收窄行。排序和过滤只改变浏览状态，不改变数据、指标口径或 text 面输出。每个 experiment 行使用原生 `<details>` 展开，展开区显示 flags 和 Eval 列表。Eval 父行只显示折叠判定、Attempt 数以及这个 Eval 的平均耗时 / 平均成本；每个 Attempt 子行再显示该轮判定、locator、耗时 / 成本与 [Scoring 定义的主失败断言摘要](../../scoring/library/display.md#主失败断言怎样选)，可继续下钻到 Attempt 详情。父行不复述某一轮的失败原因：单轮时会与唯一子行重复，多轮时挑任一轮又会冒充 Eval 级事实。passed attempt 的 Result 是 `—`，不罗列通过的 assertions。

`relativeTo` 是报告作者显式提供的可选路径前缀；设置后只缩短显示，不改变身份。默认 `ExperimentComparison` 不传它，因此始终显示完整 experiment id。排序键、过滤匹配和折叠展开也都用完整 id；视觉系列色跟随 Agent。

text 面先输出与 web 同口径的八列 experiment 比较表，再按 experiment 输出 Eval / Attempt 明细表。Eval 是父行，不是 Attempt 行上的重复字段；Attempt 用 `├─` / `└─` 子行显示一对多关系。明细列固定为状态、Eval / Attempt、结果、耗时、成本；窄终端复用标准 text table renderer 折行或从右侧隐藏低优先级列，并明确报告隐藏列数：

```text
Experiment      Model          Agent   Avg. time   Pass rate   Tokens   Cost    Results
compare/codex   gpt-5.4-mini   codex   1m 12s      50%         42k      $0.08   1 passed · 1 failed

compare/codex
Status      Eval / Attempt       Result                       Duration   Cost
✓ passed    algebra/retry                                      17.1s avg   $0.02 avg
  ✗         ├─ @1first01         equals(42) · expected 42, received 41   16.0s   $0.02
  ✓         └─ @1second2         —                            18.2s      $0.02
✗ failed    weather/tool                                      42.1s avg   $0.04 avg
  ✗         └─ @1third03         calledTool("get_weather") · received 2 other calls   42.1s   $0.04
```

窄屏允许表格横向滚动，不能为了适应宽度删除列、把多个无标签数值挤成一串，或退化成无法判断各数字含义的无表头布局。

```tsx
// 全量列表：spec 形态一行
<ExperimentList filter />
```

```tsx
// 过滤后的列表：组合组件里手工取数，用普通 JavaScript 收窄
export const ProdExperiments = defineComponent(async (_props: {}, ctx) => {
  const items = await experimentListData(ctx.scope);
  return <ExperimentList data={items.filter((x) => x.experimentId.startsWith("prod/"))} filter />;
});
```

## `EvalList`

每项表示 `experimentId + evalId`。父行显示折叠判定、Attempt 数、聚合分数、平均耗时和平均成本，展开后由每个 Attempt 子行分别显示该轮的主失败摘要或结构化错误摘要。比较层不展开全部 assertions，也不在 Eval 父行复述某个 Attempt 的失败内容。

```tsx
const items = await evalListData(ctx.scope);
<EvalList data={items.filter((x) => x.verdict !== "passed")} />
```

## `AttemptList`

每项显示一次 attempt 的判定、单行结果摘要（`failureSummary`）、Judge 分数和 locator。[内建报告的 Attempts 页](built-in.md)就是 `<AttemptList filter />`——`filter` 与 `ExperimentList` 同规则，是 web 面的渐进增强过滤框。完整 assertions、Judge evidence、diagnostics、cause 与 stack 不进 `AttemptListItem`——列表 data 只携带按 [Scoring display 契约](../../scoring/library/display.md#主失败断言怎样选)算好的摘要；需要完整结构时经 locator 回读取面（[`resolveLocator`](../../results/library.md#按-locator-寻址一个-attemptresolvelocator) → `AttemptHandle`），列表 JSON 因此不会携带 stack、evidence 或自由文本证据。最常见的失败清单有成品 [`FailureList`](#failurelist)；`AttemptList` 服务其余自选集合。

```tsx
const all = await attemptListData(ctx.scope);
const failed = all.filter((x) => x.verdict === "failed" || x.verdict === "errored");

<AttemptList data={failed.slice(0, 20)} total={failed.length} />
```

## `FailureList`

「现在有哪些失败要处理」是每份报告都要的固定区块，所以工具箱直接提供成品组合件，不用每个报告重写同一段取数过滤。它与手写组合组件严格等价：内部就是 `attemptListData` → 过滤 → `AttemptList` data 形态，没有私有能力。

- 收 `verdict` 为 `failed` 或 `errored` 的 attempt；
- 按 attempt 开始时间降序（最近的失败在前），同刻按 locator 字典序收口；
- 截断到 `limit`（默认 20），`AttemptList` 的 `total` 报告截断前总数。

```ts
type FailureListProps = {
  /** 显示的最大条数；默认 20。 */
  limit?: number;
  /** 默认宿主注入的 Scope。 */
  input?: ReportInput;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
};
```

```tsx
<FailureList limit={30} />
```

其它筛选口径（只看某个 agent、按成本排序）不属于它——写[组合组件](layout.md#自定义组件)加工 `attemptListData` 的结果，`FailureList` 只覆盖这一种最常见的问题。

## 相关阅读

- [概览组件](summaries.md) —— `ExperimentComparison` 怎样逐组消费这些列表。
- [指标组件](metric-views.md) —— 从实体切换到指标视角，及 `DataProps` 组合规则。
- [排版原语与自定义组件](layout.md) —— 承载手工取数与数组加工的组合组件。
- [Show](../show.md) —— 同一份明细在终端的展示。
