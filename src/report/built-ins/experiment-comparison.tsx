// ExperimentComparison:niceeval view 裸跑时的内置 experiment 比较报告。
//
// 名字描述整份报告回答的问题,不绑定其中某一张图。报告由成本 × 通过率散点和固定列
// ExperimentList 组成；它是一份普通 ReportDefinition,没有 renderer 私有通道。

import { Col } from "../primitives.tsx";
import { ExperimentList, MetricScatter } from "../components.tsx";
import { costUSD, passRate } from "../metrics.ts";
import { defineReport } from "../report.ts";

export const ExperimentComparison = defineReport(async ({ selection }) => {
  const experiments = await ExperimentList.data(selection);
  return (
    <Col>
      <MetricScatter selection={selection} points="experiment" series="agent" x={costUSD} y={passRate} />
      <ExperimentList items={experiments} filter />
    </Col>
  );
});
