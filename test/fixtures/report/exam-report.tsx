// view --report / show --report 测试用的真实报告文件:defineReport 默认导出,内置组件 +
// 自定义摆法 + <Style> 产物,与 docs-site/zh/guides/custom-reports.mdx 的示例同构。
// show 与 view 的宿主测试都吃这一份,两扇门同一棵树。它同时演示两种 props 形态:
// selection 形态的 ExperimentTable(宿主渲染前解析)与 data 形态的 MetricTable(预计算)。

import { Col, ExperimentTable, MetricTable, Section, Style, defineReport, passRate } from "../../../src/report/index.ts";

export default defineReport(async ({ selection }) => (
  <Col>
    <Style>{`.exam-note { color: #4a7; }`}</Style>
    <ExperimentTable selection={selection} filter />
    <Section title="考试成绩单">
      <MetricTable data={await MetricTable.data(selection, { rows: "experiment", columns: [passRate] })} />
    </Section>
  </Col>
));
