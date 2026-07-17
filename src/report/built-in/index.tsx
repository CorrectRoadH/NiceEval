// niceeval/report/built-in —— 包里自带的一个报告文件,没有任何私有钩子
// (docs/feature/reports/library/built-in.md)。裸 `niceeval show` 与 `niceeval view`
// 装载的就是这份默认导出:一份普通 defineReport,与用户的 --report 文件同层、
// 走同一条 装载 → resolve → validate → render 管线。「builtin」不是装载逻辑里的类别,
// 只是宿主默认拿哪个值的事实。
//
// 三页站点:report(Hero + 警告 + 批量修复 prompt + 实验对比)、attempts(带过滤的
// attempt 全列表)、traces(执行瀑布)。裸宿主导航上能看到的一切内容都在这份定义里;
// 宿主保留的只有机器(docs/feature/reports/architecture.md「宿主保留的只有机器」)。

import {
  AttemptList,
  Col,
  CopyFixPrompt,
  ExperimentComparison,
  Hero,
  ScopeWarnings,
  TraceWaterfall,
  defineReport,
} from "../index.ts";

export default defineReport({
  pages: [
    {
      id: "report",
      title: { en: "Report", "zh-CN": "报告" },
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <CopyFixPrompt />
          <ExperimentComparison />
        </Col>
      ),
    },
    {
      id: "attempts",
      title: "Attempts",
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <AttemptList filter />
        </Col>
      ),
    },
    {
      id: "traces",
      title: { en: "Traces", "zh-CN": "追踪" },
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <TraceWaterfall />
        </Col>
      ),
    },
  ],
});
