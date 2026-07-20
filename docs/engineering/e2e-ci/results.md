# 报告域

报告域回答一个问题：**一次真实运行落盘的结果与对外的报告出口，是否逐字段符合公开契约。** 它由一个 mechanism 仓库承担：`results`（group `mechanism`）。适配器仓库不复制格式知识，读结果只走公开读取面（见[总则 · Results 读取边界](README.md#42-results-读取边界)）。

仓库使用真实 Agent 与真实模型产生结果——真实优先没有例外。稳定性来自断言对象：只断言机制事实（文件集合、字段形状、口径一致性），不断言模型输出质量。

## 验收计划

仓库运行一个小型真实 Experiment，然后从四个出口逐一核对同一份事实：

1. **落盘格式**：`snapshot.json`、attempt 目录的 `result.json`、`events.json`、`sources.json`、`o11y.json`（有 tracing 面时含 `trace.json`）的字段与版本依据 [Results Format](../../feature/results/architecture.md) 契约逐项断言——`verdict` 四态、断言明细、`durationMs` / `usage` / `estimatedCostUSD` 三件套成组出现、`snapshot.json` 不含逐 attempt 数据。
2. **公开读取面**：`openResults()` 遍历出的快照、attempt 与推导聚合和盘上文件一致——读取面是落盘事实的忠实投影，不是第二份口径。
3. **JSON 出口**：CLI `--json` 输出的机器摘要与读取面口径一致。
4. **JUnit 出口**：显式 `--junit` 文件里 `failed` 折叠为 `<failure>`、`errored` 折叠为 `<error>`，用例集合与实际 attempt 对应。
5. **视图出口（视觉与交互）**：对同一次运行执行 `niceeval view --out` 导出静态站，用真实浏览器打开 index 与失败 attempt 的 `attempt/<locator>.html` 文档，验收「组件 + 官方 stylesheet」在真实证据上的组合成立：详情各语义块是结构化布局而非 UA 默认排版；源码行按 [`AttemptSource` 视觉规范](../../feature/reports/library/attempt-detail.md#attemptsource-web-面视觉规范)呈现状态染色与行号位标记；点击 send / assertion 行由原生 `<details>` 展开行内回复与断言细节，普通行不可展开；文档零 JS 依赖（禁 JS 后上述内容仍完整可读）。断言停在「规则生效、交互可达」，不锁颜色值、像素或完整 class 列表。

格式变更只需要更新这个仓库，不需要修改任何适配器仓库。

## 边界

show / view 的终端布局与 HTML **结构事实**（区块存在与顺序、计数、expected / received 文本、默认展开标记）归[单元测试 Reports](../unit-tests/reports/README.md)——那是确定性渲染语义，静态 render 即可断言。本仓库的视图出口验收（上表第 5 条）只承接单元层断言不到的部分：官方 stylesheet 与组件组合后的实际观感与浏览器交互。落盘文件、读取面与机器出口的逐字段契约仍是本仓库其余四条的责任。

每个仓库验收链尾的 [CLI 读回](README.md#43-cli-读回)会在真实数据上驱动 show 的读取与渲染路径，但断言停在自有事实的出现与口径一致；逐字段的格式与出口契约只在本仓库验收一次。
