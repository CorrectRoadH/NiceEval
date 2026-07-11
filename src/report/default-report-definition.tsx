// defaultReport:官方两扇门裸跑时渲染的内置默认报告(`niceeval show` ≡
// `show --report <这一份>`;view 的接线在宿主侧)。与 <DefaultReport />(零 props 锚点、
// 渲染宿主注入的官方水位)不同,这是一份普通 ReportDefinition:build 里用 ctx.selection
// 现算,零特权 —— 数据全部来自公开计算函数,用户自己的报告文件写得出一模一样的东西。
//
// 单独成文件而不并进 default-report.tsx:report.ts(defineReport 的家)在模块图上
// 先于 default-report.tsx 求值(它注入官方水位),default-report.tsx 顶层调 defineReport
// 会踩 REPORT_DEFINITION 的 TDZ;这里晚于两者装载,没有环。

import type { Selection, Snapshot } from "../results/index.ts";
import { experimentGroupOf } from "../shared/aggregate.ts";
import { defineReport, type ReportDefinition } from "./report.ts";
import type { ReportNode } from "./tree.ts";
import { Col, Section } from "./primitives.tsx";
import { MetricScatter, MetricTable, RunOverview } from "./components.tsx";
import { costUSD, durationMs, passRate, tokens } from "./metrics.ts";

/** 组键:experiment id 的目录前缀(与 view 榜单分组同一份推导);顶层实验(id 无 "/")无组。 */
function groupOf(snapshot: Snapshot): string | undefined {
  return experimentGroupOf(snapshot.experimentId);
}

/** 一个组的积木:组内 frontier 散点(可画点 < 2 时省略,画不出比较就不画)+ 带过滤的榜单。 */
async function groupBlocks(scoped: Selection, keyPrefix: string): Promise<ReportNode[]> {
  const blocks: ReportNode[] = [];
  const scatter = await MetricScatter.data(scoped, {
    points: "experiment",
    series: "agent",
    x: costUSD,
    y: passRate,
  });
  const drawable = scatter.rows.filter((r) => r.x.value !== null && r.y.value !== null).length;
  if (drawable >= 2) blocks.push(<MetricScatter key={`${keyPrefix}:scatter`} data={scatter} />);
  blocks.push(
    <MetricTable
      key={`${keyPrefix}:board`}
      data={await MetricTable.data(scoped, {
        rows: "experiment",
        columns: [durationMs, passRate, tokens, costUSD],
        sort: passRate,
        // 每个 experiment 行按 eval 展开明细(同一套 columns 在题级重算 + 判定/原因/深链):
        // 点开一个 experiment 直接看它每道题为什么过/不过,不用去另一个板块找。
        expand: "eval",
      })}
      filter
    />,
  );
  return blocks;
}

/**
 * 内置默认报告:官方宿主(`niceeval show` / `niceeval view`)裸跑时的报告槽出厂填充。
 *
 * 形态:顶部 {@link RunOverview};按 experiment 组(id 的目录前缀,如 `compare/bub-low`
 * 的 `compare`)每组一个 `<Section title={组名}>`,内含组内成本 × 通过率的
 * {@link MetricScatter}(组内可画点 < 2 时省略图)与组内榜单 {@link MetricTable}
 * (行 = experiment,附 Model / Agent / Verdicts 列,过滤输入框开,`expand: "eval"`——每行可
 * 展开看这个 experiment 每道题的判定/原因,零 JS 靠原生 `<details>`);无组的实验直接平铺,
 * 不发明组名。组内 Selection 用 `Selection.filter`(只删不换)收窄,warnings 随行修剪。
 *
 * 它是普通的 {@link ReportDefinition}:`--report` 换掉它,或在自己的报告文件里
 * import 后当参照并排都行。
 */
export const defaultReport: ReportDefinition = defineReport(async ({ selection }) => {
  const groupKeys: (string | undefined)[] = [];
  for (const snapshot of selection.snapshots) {
    const key = groupOf(snapshot);
    if (!groupKeys.includes(key)) groupKeys.push(key);
  }

  const sections: ReportNode[] = [];
  for (const key of groupKeys) {
    const scoped = selection.filter((s) => groupOf(s) === key);
    const blocks = await groupBlocks(scoped, key ?? "(ungrouped)");
    if (key === undefined) sections.push(...blocks);
    else {
      sections.push(
        <Section key={key} title={key}>
          {blocks}
        </Section>,
      );
    }
  }

  return (
    <Col>
      <RunOverview data={await RunOverview.data(selection)} />
      {sections}
    </Col>
  );
});
