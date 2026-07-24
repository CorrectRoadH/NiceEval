// Report 公开组件的 BDD 风格验收入口。
//
// 每个行为场景按用户认识的公开组件族分文件，场景上方用中文 Given / When / Then 注释说明
// 契约；本文件只负责组合和顺序。所有场景共享 scripts/evidence.ts 产出的同一次真实 Evidence、
// branded/site 每份报告各一次静态导出和一个浏览器进程，不重新跑 Experiment。
//
// 这里仍遵守 E2E 的线性 fail-fast 协议，不引入 Cucumber/Vitest。runReportComponentScenarios
// 会给失败补上场景名，因此日志能直接定位到组件行为，而不是落回一个四百行的综合脚本。

import type { Evidence } from "./evidence.ts";
import { attemptDetailScenarios } from "./report-components/attempt-detail.scenarios.ts";
import { attemptListScenarios } from "./report-components/attempt-list.scenarios.ts";
import { attemptSourceScenarios } from "./report-components/attempt-source.scenarios.ts";
import {
  runReportComponentScenarios,
  withReportComponentScenarioContext,
} from "./report-components/harness.ts";
import { gridStatScenarios } from "./report-components/grid-stat.scenarios.ts";
import { metricMatrixScenarios } from "./report-components/metric-matrix.scenarios.ts";
import { metricTableScenarios } from "./report-components/metric-table.scenarios.ts";
import { scoreboardScenarios } from "./report-components/scoreboard.scenarios.ts";
import { sectionScenarios } from "./report-components/section.scenarios.ts";
import { siteShellScenarios } from "./report-components/site-shell.scenarios.ts";

export async function verifyCustomReports(evidence: Evidence): Promise<void> {
  await withReportComponentScenarioContext(evidence, async (ctx) => {
    await runReportComponentScenarios(ctx, siteShellScenarios);
    await runReportComponentScenarios(ctx, sectionScenarios);
    await runReportComponentScenarios(ctx, gridStatScenarios);
    await runReportComponentScenarios(ctx, metricMatrixScenarios);
    await runReportComponentScenarios(ctx, scoreboardScenarios);
    await runReportComponentScenarios(ctx, metricTableScenarios);
    await runReportComponentScenarios(ctx, attemptListScenarios);
    await runReportComponentScenarios(ctx, attemptDetailScenarios);
    await runReportComponentScenarios(ctx, attemptSourceScenarios);
  });
}
