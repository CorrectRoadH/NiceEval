# 概览组件

回答“这批结果有多大、整体是否健康、当前水位在哪”的两个层次：`ScopeSummary` 是有 `scopeSummaryData` 的叶子数据组件；`ExperimentComparison` 是内建首页使用的 report-only 普通组合组件，只把 `ScopeSummary`、`MetricScatter` 与 `ExperimentList` 摆在一起，不发明自己的 data 形状或渲染面。

## `ExperimentComparison`

裸 `niceeval show` 与 `niceeval view` 首页经由[内建报告](built-in.md)渲染的默认组合件。它把同一个 `input` 显式传给 `ScopeSummary`、成本 × 端到端通过率的 `MetricScatter` 和 `ExperimentList`。每个叶子组件按自己的公开契约取数；组合件不合并结果、不缓存第二份 `ExperimentComparisonData`，共享计算由报告 resolve 的“同引用 input + 深相等 spec”记忆化保证。

Scope 内任一实验声明了 [`labels`](../../experiments/library.md#labels声明归类坐标不进运行时) 的 `line` 键，散点就按 `label("line")` 归类并连线；否则按 `"agent"` 归类、不连线。显式传 `series` / `connect` 时采用显式值，`connect` 与 [`MetricScatter`](metric-views.md#metricscatter) 同一契约。

端到端通过率对同一 experiment × eval 的多轮 attempt 先求均值，再跨 experiment × eval 求均值；`failed` 与 `errored` 为 0，`skipped` 为 `null`。摘要中的 verdict 构成另按 Eval 最终 verdict 计票：任一轮 passed 则 Eval passed，否则按 `failed > errored > skipped` 折叠。

web 与 text 两面都输出当前 Scope 的摘要、散点和实验列表，不设组索引或组选择器；这是三个叶子组件各自双面输出后按 `Col` 排列的结果，不是 `ExperimentComparison` 自己实现第三套 renderer。

```ts
interface ExperimentComparisonProps {
  input?: ReportInput;
  /** 散点的 series 维度。缺省:有 label `line` 声明 → label("line") 并连线;否则 "agent"、不连线。 */
  series?: SeriesInput;
  /** 透传给散点；契约同 MetricScatter 的 connect。 */
  connect?: boolean;
  locale?: ReportLocale;
  className?: string;
}
```

```tsx
<ExperimentComparison />
<ExperimentComparison series={label("line")} connect />
```

Experiment 按端到端通过率从高到低预排。要比较某个子集，先用宿主的 `--exp` 收窄，或在自定义报告里对 Scope 调 `filter`。

它等价于下面这类普通组合，具体默认 series 的选择也在 compose 阶段完成：

```tsx
export const ExperimentComparison = defineComponent((props, ctx) => {
  const input = props.input ?? ctx.scope;
  const { series, connect } = resolveComparisonSeries(input, props);
  return (
    <Col className={props.className}>
      <ScopeSummary input={input} locale={props.locale} />
      <MetricScatter
        input={input}
        points="experiment"
        series={series}
        connect={connect}
        x={costUSD}
        y={endToEndPassRate}
        locale={props.locale}
      />
      <ExperimentList input={input} filter locale={props.locale} />
    </Col>
  );
});
```

因此 `ExperimentComparison` 只从 `niceeval/report` 导出，不从 `niceeval/report/react` 导出；自有 React 页面分别计算并组合三个叶子组件的 data。

## `ScopeSummary`

显示一个范围的快照时间窗、experiment / eval / attempt 数、两级判定结果、端到端通过率和总成本。Eval 的身份键是 `experimentId + evalId`：同一个 Eval 在不同 experiment 中运行时算两个独立 Eval，`evals` 与 `evalVerdicts` 都按这个身份计数。`ExperimentComparison` 用它概括完整输入。

web 面使用短标签 `Pass rate / 通过率`、`Experiments / 实验`、`Evals / Eval`、`Attempts / Attempt`、`Eval results / Eval 结果`（`votes="attempt"` 时为 `Attempt results / Attempt 结果`）和 `Total cost / 总成本`。这些是字段名，不在标签里重复“数”“次”或“计票”；数量由值本身表达。时间不直接暴露 ISO 字符串：单点写成 `Last run / 最近运行`，范围写成 `Run range / 运行范围`，时间值按当前 locale 格式化到分钟；同日范围不重复右端日期，同年跨日范围不重复右端年份。成本覆盖不全时，在金额下方用 `Cost available for 63/72 attempts / 63/72 次有成本数据` 解释覆盖范围，不能只放一个无语义的 `63/72` 角标。

data 恒携带两级计票，两份序列化 JSON 摆在一起时口径自明；渲染面显示哪一级由呈现 prop `votes` 决定：

- `evalVerdicts`（`votes: "eval"`，默认）：每个 experimentId + evalId 先按「任一轮 passed 即 passed，否则 `failed > errored > skipped`」折成最终 verdict 后计票，回答「多少个 Eval 最终通过」。
- `attemptVerdicts`（`votes: "attempt"`）：attempt 原始计票，不折叠，回答「实际跑的每一轮各是什么结果」。

两级计票与 `endToEndPassRate` 互不反推：通过率来自官方两级指标引擎，渲染面不得从任一计票现场重算。Scope warning 不进 `ScopeSummaryData`：警告的呈现件是 [`ScopeWarnings`](site-components.md#scopewarnings)，摘要数据不复制它的输入，同一份事实不在页面上出现两次。

```ts
interface ScopeSummaryData {
  /** 贡献当前数据的快照时间范围；空范围为 null，不编造当前时间。 */
  range: { earliestStartedAt: string | null; latestStartedAt: string | null };
  experiments: number;
  /** experimentId + evalId 的去重计数。 */
  evals: number;
  attempts: number;
  /** 每个 experimentId + evalId 先折成最终 verdict 后计票。 */
  evalVerdicts: { passed: number; failed: number; errored: number; skipped: number };
  /** attempt 原始计票，不折叠。 */
  attemptVerdicts: { passed: number; failed: number; errored: number; skipped: number };
  /** 官方两级 endToEndPassRate，不从任一计票重算。 */
  endToEndPassRate: MetricCell;
  /** costUSD 按 attempt 求和；缺失成本不伪造为 0。 */
  totalCostUSD: MetricCell;
}

function scopeSummaryData(input: ReportInput): Promise<ScopeSummaryData>;

type ScopeSummaryProps = DataProps<ScopeSummaryData, {}, {
  /** 显示哪一级计票；默认 "eval"。data 恒携带两级，votes 只选择呈现。 */
  votes?: "eval" | "attempt";
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<ScopeSummary />                    // 当前 Scope 的摘要，eval 级计票
<ScopeSummary votes="attempt" />    // 同一份 data，改看 attempt 原始计票
```

收窄范围时在[组合组件](layout.md#自定义组件)里显式传 `input`：

```tsx
const CompareSummary = defineComponent((_props: {}, ctx) => (
  <ScopeSummary input={ctx.scope.filter((s) => s.experimentId.startsWith("compare/"))} />
));
```

## 相关阅读

- [实体列表](entity-lists.md) —— 从汇总下钻到 experiment / eval / attempt。
- [指标组件](metric-views.md) —— 榜单、矩阵、散点与趋势，及 `DataProps` 组合规则。
- [内建报告](built-in.md) —— 裸宿主装载的默认定义。
