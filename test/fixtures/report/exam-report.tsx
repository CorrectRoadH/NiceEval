// view --report / show --report 测试用的真实报告文件:defineReport 树形态默认导出,
// 内置组件 + 自定义摆法 + <Style> 产物,与 docs-site/zh/how-to/custom-reports.mdx 的示例
// 同构。show 与 view 的宿主测试都吃这一份,两扇门同一棵树。组件全部写 spec 形态,
// 数据来源默认宿主注入的 Scope,由管线在 resolve 阶段代调配套 *Data——作者不写取数管道。

import { Col, ExperimentList, MetricTable, Section, Style, defineReport, taskPassRate } from "niceeval/report";

export default defineReport(
  <Col>
    <Style>{`.exam-note { color: #4a7; }`}</Style>
    <ExperimentList />
    <Section title="考试成绩单">
      <MetricTable rows="experiment" columns={[taskPassRate]} />
    </Section>
  </Col>,
);
