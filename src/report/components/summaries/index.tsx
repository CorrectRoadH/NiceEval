// 官方双面组件的装配点:web 面(./ScopeSummary.tsx 的纯 React 组件)+ text 面(./faces.ts)
// + resolve 解析面(spec 形态由管线代调配套 ./compute.ts)。ScopeSummary 与 ExperimentComparison
// 同属汇总族——前者是范围摘要卡,后者是内建报告默认使用的组合件(装配 ScopeSummary +
// MetricScatter + ExperimentList,不产生自己的 data)。

import { defineComponent, type ReportComponent } from "../../definition/tree.ts";
import { Col } from "../../definition/primitives.tsx";
import type { ReportInput, ScopeSummaryData, SeriesInput } from "../../model/types.ts";
import { resolveInput, seriesName } from "../../model/aggregate.ts";
import { label } from "../../model/flag.ts";
import { costUSD, endToEndPassRate } from "../../model/metrics.ts";
import {
  isObject,
  isTally,
  isCell,
  makeDataComponent,
  type ChromeProps,
  type DataProps,
  type Validator,
} from "../shared.ts";
import { scopeSummaryData } from "./compute.ts";
import { scopeSummaryText } from "./faces.ts";
import { ScopeSummary as ScopeSummaryWeb } from "./ScopeSummary.tsx";
import { MetricScatter } from "../metric-views/index.tsx";
import { ExperimentList } from "../entity-lists/index.tsx";

const validateScopeSummaryData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!isObject(data.range)) return 'missing "range" ({ earliestStartedAt, latestStartedAt })';
  if (!isTally(data.evalVerdicts) || !isTally(data.attemptVerdicts)) {
    return 'missing "evalVerdicts" / "attemptVerdicts" tallies';
  }
  if (!isCell(data.endToEndPassRate) || !isCell(data.totalCostUSD)) {
    return 'missing "endToEndPassRate" / "totalCostUSD" (MetricCell)';
  }
  return null;
};

// ───────────────────────── 概览组件 ─────────────────────────

export type ScopeSummaryProps = DataProps<
  ScopeSummaryData,
  Record<never, never>,
  ChromeProps & {
    /** 显示哪一级计票;默认 "eval"。data 恒携带两级,votes 只选择呈现。 */
    votes?: "eval" | "attempt";
  }
>;

/** 范围摘要卡:时间窗、数量、两级计票、端到端通过率与总成本。 */
export const ScopeSummary = makeDataComponent<
  ScopeSummaryData,
  Record<never, never>,
  ChromeProps & { votes?: "eval" | "attempt" }
>({
  name: "ScopeSummary",
  dataFnName: "scopeSummaryData",
  shapeName: "ScopeSummaryData",
  dataFn: (input) => scopeSummaryData(input),
  specKeys: [],
  validate: validateScopeSummaryData,
  web: (props, ctx) => <ScopeSummaryWeb {...props} locale={props.locale ?? ctx.locale} />,
  text: (props, ctx) => scopeSummaryText(props.data, props.votes ?? "eval", ctx),
}) as unknown as ReportComponent<ScopeSummaryProps>;

type ComparisonChrome = ChromeProps & {
  /** 透传给散点;缺省跟随缺省 series 解析——按 line 归类时连线(声明了线就画线)。 */
  connect?: boolean;
};

export type ExperimentComparisonProps = ComparisonChrome & {
  input?: ReportInput;
  /** 散点的 series 维度。缺省解析:Scope 内任一实验声明了 label `line` → `label("line")` 并连线;否则 `"agent"`、不连线。 */
  series?: SeriesInput;
};

/** 默认报告识别的归类键:声明了它的实验按线归类并连线(docs/feature/experiments/library.md「labels」)。 */
const LINE_LABEL_KEY = "line";

/**
 * 缺省 series:Scope 内任一快照声明了 labels.line 用 line 维度,否则 agent;显式传入覆盖。
 * connect 缺省跟随最终 series 是否解析为 line(即便是显式传入的)。
 */
function resolveComparisonSeries(
  input: ReportInput,
  props: { series?: SeriesInput; connect?: boolean },
): { series: SeriesInput; connect: boolean } {
  const hasLine = resolveInput(input).snapshots.some((s) => s.experiment?.labels?.[LINE_LABEL_KEY] !== undefined);
  const series = props.series ?? (hasLine ? label(LINE_LABEL_KEY) : "agent");
  return { series, connect: props.connect ?? seriesName(series) === LINE_LABEL_KEY };
}

/**
 * 内建报告的默认组合件:把同一个 input(缺省 ctx.scope)原样透传给 ScopeSummary、
 * 成本 × 端到端通过率的 MetricScatter 与 ExperimentList——组合本身不二次计算或过滤,
 * 也不导出自己的 data 形态;每个叶子组件按自己的公开契约取数,共享计算由 resolve 的
 * 「同引用 input + 深相等 spec」记忆化保证。
 */
export const ExperimentComparison = defineComponent<ExperimentComparisonProps>((props, ctx) => {
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
ExperimentComparison.displayName = "ExperimentComparison";
