// defaultReport:官方两扇门裸跑时渲染的内置默认报告(`niceeval show` ≡
// `show --report <这一份>`;view 的接线在宿主侧)。与 <DefaultReport />(零 props 锚点、
// 渲染宿主注入的官方水位)不同,这是一份普通 ReportDefinition:build 里用 ctx.selection
// 现算,零特权 —— 数据全部来自公开计算函数,用户自己的报告文件写得出一模一样的东西。
//
// 单独成文件而不并进 official-report.tsx:report.ts(defineReport 的家)在模块图上
// 先于 official-report.tsx 求值(它注入官方水位),official-report.tsx 顶层调 defineReport
// 会踩 REPORT_DEFINITION 的 TDZ;这里晚于两者装载,没有环。

import type { Selection, Snapshot } from "../results/index.ts";
import { experimentGroupOf } from "../shared/aggregate.ts";
import { defineReport, type ReportDefinition } from "./report.ts";
import type { ReportNode } from "./tree.ts";
import { Col, Section } from "./primitives.tsx";
import { ExperimentTable, GroupSummary, MetricScatter, RunOverview } from "./components.tsx";
import { costUSD, passRate } from "./metrics.ts";
import type { ExperimentTableData, GroupSummaryData, ScatterData } from "./types.ts";

/** 组键:experiment id 的目录前缀(与 view 榜单分组同一份推导);顶层实验(id 无 "/")无组。 */
function groupOf(snapshot: Snapshot): string | undefined {
  return experimentGroupOf(snapshot.experimentId);
}

/** 全部组键,按 selection 内首次出现的顺序去重;顶层实验(id 无 "/")的组键是 `undefined`。 */
function groupKeysOf(selection: Selection): (string | undefined)[] {
  const keys: (string | undefined)[] = [];
  for (const snapshot of selection.snapshots) {
    const key = groupOf(snapshot);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

interface GroupData {
  summary: GroupSummaryData;
  scatter: ScatterData;
  experiments: ExperimentTableData;
}

/** 一个组(已用 `groupOf` 收窄好的 Selection)的三份数据:摘要 + 成本×通过率散点 + Experiment 工作台。 */
async function groupData(scoped: Selection): Promise<GroupData> {
  const [summary, scatter, experiments] = await Promise.all([
    GroupSummary.data(scoped),
    MetricScatter.data(scoped, { points: "experiment", series: "agent", x: costUSD, y: passRate }),
    ExperimentTable.data(scoped),
  ]);
  return { summary, scatter, experiments };
}

/** 一个组的积木:摘要 + 组内 frontier 散点(可画点 < 2 时省略)+ 可展开的 Experiment 工作台。 */
function groupNodes(keyPrefix: string, data: GroupData): ReportNode[] {
  const blocks: ReportNode[] = [<GroupSummary key={`${keyPrefix}:summary`} data={data.summary} />];
  const drawable = data.scatter.rows.filter((r) => r.x.value !== null && r.y.value !== null).length;
  if (drawable >= 2) blocks.push(<MetricScatter key={`${keyPrefix}:scatter`} data={data.scatter} />);
  blocks.push(<ExperimentTable key={`${keyPrefix}:experiments`} data={data.experiments} filter />);
  return blocks;
}

/**
 * 内置默认报告:官方宿主(`niceeval show` / `niceeval view`)裸跑时的报告槽出厂填充。
 *
 * 形态:顶部 {@link RunOverview};按 experiment 组(id 的目录前缀,如 `compare/bub-low`
 * 的 `compare`)每组一个 `<Section title={组名}>`,内含组摘要 {@link GroupSummary}
 * (通过率、experiment/eval/attempt 数、failed/errored、总成本、最后运行时间)、组内成本 ×
 * 通过率的 {@link MetricScatter}(组内可画点 < 2 时省略图)与组内 {@link ExperimentTable}
 * (一行一个 experiment,整行原生 `<details>` 展开配置、KPI、逐 eval/attempt 证据和原始
 * 样例;主行不铺 attempt refs);无组的实验直接平铺同一套 blocks,不发明组名。组内 Selection 用
 * `Selection.filter`(只删不换)收窄,warnings 随行修剪。
 *
 * 它是普通的 {@link ReportDefinition}:`--report` 换掉它,或在自己的报告文件里
 * import 后当参照并排都行。
 */
export const defaultReport: ReportDefinition = defineReport(async ({ selection }) => {
  const sections: ReportNode[] = [];
  for (const key of groupKeysOf(selection)) {
    const scoped = selection.filter((s) => groupOf(s) === key);
    const data = await groupData(scoped);
    const blocks = groupNodes(key ?? "(ungrouped)", data);
    if (key === undefined) sections.push(...blocks);
    else {
      sections.push(
        <Section key={key} title={key}>
          {blocks}
        </Section>,
      );
    }
  }

  // 拼成一个扁平数组再整体作为 Col 的唯一子节点:JSX 里 `<Col><A/>{sections}</Col>` 会让
  // `sections`(本身是数组)与 `<A/>` 一起被 React.createElement 打包成嵌套数组
  // `[A, sections]`,text 面的数组分支(tree.ts renderNodeToText)按嵌套层级各自 join,
  // 内层只用单换行而非 Col 的段落间距 "\n\n" —— 多组场景下组与组之间会丢空行。
  // 这里手工展平成一层,交给 Col 的 childArray 统一处理。
  const overview = <RunOverview key="overview" data={await RunOverview.data(selection)} />;
  return <Col>{[overview, ...sections]}</Col>;
});
