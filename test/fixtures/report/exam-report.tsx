// view --report / show --report 测试用的真实报告文件:defineReport 默认导出,内置组件 +
// 自定义摆法 + <Style> 产物,与 docs-site/zh/guides/custom-reports.mdx 的示例同构。
// show 与 view 的宿主测试都吃这一份,两扇门同一棵树。它同时演示两种数据形态:
// ExperimentList 没有 selection-form,报告函数体里直接 `await ExperimentList.data(selection)`
// 拿到普通数组再传 `items`;MetricTable 走预计算的 data 形态。

import { Col, ExperimentList, MetricTable, Section, Style, defineReport, taskPassRate } from "niceeval/report";

export default defineReport(async ({ selection }) => {
  const experiments = await ExperimentList.data(selection);
  return (
    <Col>
      <Style>{`.exam-note { color: #4a7; }`}</Style>
      <ExperimentList items={experiments} />
      <Section title="考试成绩单">
        <MetricTable data={await MetricTable.data(selection, { rows: "experiment", columns: [taskPassRate] })} />
      </Section>
    </Col>
  );
});
