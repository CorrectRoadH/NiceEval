// 等价性测试夹具:原样 re-export 内置默认报告 CostPassRateComparison。
// 用它验证 `niceeval view` ≡ `niceeval view --report <CostPassRateComparison>` ——
// 内置报告是公开导出的普通 ReportDefinition,没有私有通道(docs/reports.md)。

export { CostPassRateComparison as default } from "../../../src/report/built-ins/index.ts";
