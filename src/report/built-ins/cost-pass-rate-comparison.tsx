// CostPassRateComparison:show / view 裸跑时的出厂报告槽。
//
// 它是一份普通 ReportDefinition,零特权:只声明「摆什么」——成本 × 通过率的散点(比较
// experiments)和 Experiment 诊断工作台。组件自己负责从注入的 Selection 解析数据(渲染前的
// resolveReportTree 完成异步解析),报告文件本身不写任何数据装配 JavaScript。包外用户复制这段
// TSX(只改 import 路径与 export 形式)会走完全相同的解析与渲染管线。

import { Col } from "../primitives.tsx";
import { ExperimentTable, MetricScatter } from "../components.tsx";
import { costUSD, passRate } from "../metrics.ts";
import { defineReport } from "../report.ts";

export const CostPassRateComparison = defineReport(({ selection }) => (
  <Col>
    <MetricScatter selection={selection} points="experiment" series="agent" x={costUSD} y={passRate} />
    <ExperimentTable selection={selection} filter />
  </Col>
));
