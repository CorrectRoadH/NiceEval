// 等价性测试夹具:原样 re-export 内置默认报告。
// 用它验证 `niceeval view` ≡ `niceeval view --report <defaultReport>` ——
// defaultReport 是公开导出的普通 ReportDefinition,没有私有通道(docs/reports.md)。

export { defaultReport as default } from "../../../src/report/default-report.tsx";
