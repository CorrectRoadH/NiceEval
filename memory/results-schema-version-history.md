# Results Format schemaVersion 历史台账

`docs/feature/results/architecture.md` 正文只声明当前版本;逐版差异与升版原因在这里维护(每次递增 `schemaVersion` 时追加一行)。

- `1` 初版。
- `2`(2026-07)`ExperimentRunInfo.flags` 改名 `params`。
- `3`(2026-07-10)改回 `flags`(A/B feature flag 语义定稿,见 experiment-flags-naming-reversal 条目)。
- `4`(2026-07-11)落盘单位从 run 改为快照:实验目录在外层,快照元数据住 `snapshot.json`,判定住 attempt 级 `result.json`,run 级 `summary.json` 废除(见 results-per-snapshot 条目)。
- `5`(2026-07-12)`result.json` 新增 `locator`;`sources.json` 从逐 attempt 内联全量源码改为「attempt 级引用 + 快照级 `sources/<sha256>.json` 去重仓库」(见 attempt-locator-and-source-dedup 条目)。
- `6`(2026-07-13)`error` 从自由字符串改为结构化 `AttemptError`(operation/code/message/cause/stack),新增有界 `diagnostics`。
- `7`(2026-07-14)`AttemptError.operation` / `DiagnosticRecord.operation` 改名 `phase`,取值统一为 `LifecyclePhase` 闭集(见 lifecycle-phase-vocabulary-unification 条目);`phases` 收尾段与 `steps` 属同期新增的可选字段,本身不要求升版,搭改名的车一起进 7。
