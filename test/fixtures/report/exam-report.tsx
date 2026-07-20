// view --report / show --report 测试用的真实报告文件:defineReport 树形态默认导出,
// 内置组件 + 自定义摆法 + <Style> 产物 + Section.meta/Grid/Stat 排版原语,与
// docs-site/zh/tutorials/custom-reports.mdx 的示例同构。show 与 view 的宿主测试都吃这一份,
// 两扇门同一棵树。组件全部写 spec 形态,数据来源默认宿主注入的 Scope,由管线在 resolve
// 阶段代调配套 *Data——作者不写取数管道。Grid/Stat 只呈现作者手写的已格式化摘要,
// 不读 Scope、不聚合 Metric,证明它们能与数据组件在同一棵树里共存。

import { Col, ExperimentList, Grid, MetricTable, Section, Stat, Style, defineReport, taskPassRate } from "niceeval/report";

export default defineReport(
  <Col>
    <Style>{`.exam-note { color: #4a7; }`}</Style>
    <ExperimentList />
    <Section title="考试成绩单">
      <MetricTable rows="experiment" columns={[taskPassRate]} />
    </Section>
    <Section title="速览" meta="人工摘要,非计算结果">
      <Grid columns={2} variant="boxed">
        <Stat label="及格线" value="60 分" tone="neutral" />
        <Stat label="最高分" value="97 分" detail="来自 compare/codex" tone="positive" />
      </Grid>
    </Section>
  </Col>,
);
