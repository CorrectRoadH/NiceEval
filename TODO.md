# defaultReport 行为校准重构 TODO

> 目标：校准 `d0b6718` 把旧 `niceeval view` 首页迁入双面组件框架时产生的行为漂移。恢复旧界面的正确公式、语义和信息密度，同时保留“所有实验组同时可见、无分组实验不隐藏”等修复。默认报告仍是一份零特权的普通 `ReportDefinition`，`niceeval show` 与 `niceeval view` 共用同一份定义和计算结果。

## 不可变设计

- [x] 默认报告继续只由公开计算函数、双面组件和排版原语组成；不得读取私有 view 数据，不得在 `validateReportTree` 中给它加白名单。
- [x] 报告树里不得出现裸 HTML 叶子；新增视觉块必须是 `defineComponent({ web, text })` 定义的双面组件，或由现有 `Text` / `Row` / `Col` / `Section` / `Style` 组合。
- [x] web face 和 text face 只展示已经算好的数据，不现场推导通过率、Verdict、成本或失败原因。
- [x] 所有实验组同时渲染；不得恢复旧 `GroupSelector` 的“只显示当前组”状态模型。
- [x] 没有 `/` 前缀的实验继续直接显示；不得因为没有组名而过滤。
- [x] 默认报告不得获得自定义报告作者无法调用的计算能力。
- [x] `passRate` 的唯一官方口径是现有 `computeCell(passRate, items)` 两级聚合；不得用 attempt 原始计数替代。
- [x] 失败原因只来自 `error`、`skipReason` 和未通过的 gate assertion；soft assertion 只影响得分摘要，不冒充失败原因。
- [x] “平均成本”和“总成本”必须使用不同字段与文案：指标格 `costUSD` 保持现有聚合口径，组摘要总成本按可测 attempt 成本求和。

## 目标组件结构

```tsx
<Col>
  <RunOverview data={await RunOverview.data(selection)} />

  <Section title={groupName}>
    <GroupSummary data={await GroupSummary.data(groupSelection)} />
    <MetricScatter data={scatterData} />
    <ExperimentTable data={experimentData} filter />
  </Section>

  {/* 无分组实验直接摆相同 blocks，不发明虚构组名。 */}
</Col>
```

- [x] 不新增通用网格/卡片排版原语。组摘要确实是一个有独立数据契约的报告块，因此新增 `GroupSummary` 双面组件；`Section` 仍负责分组容器。
- [x] 默认报告使用公开双面 `ExperimentTable` 复刻旧诊断工作台；通用 `MetricTable.expand` 保留给自定义报告，但不承担默认首页。
- [x] 旧 `CostScoreChart` 的正确图表行为由现有 `MetricScatter` 承接；只校准数据和视觉规则，不恢复旧 React 组件。
- [x] 旧 `GroupSelector` 不迁回；它提供的组汇总数字迁入 `GroupSummary`，选择交互废弃。

## 1. 先锁定行为基线

- [x] 在 `src/report/dual-render.test.tsx` 增加能区分三种通过率算法的 fixture：不同 eval 拥有不同 attempt 数，并包含 partial credit。
- [x] 断言 `RunOverview` 的 web/text 两面显示 `computeCell(passRate)` 的同一个 `MetricCell.display`。
- [x] 增加 grouped 与 ungrouped snapshots 混合用例，断言所有组和无分组实验都出现一次。
- [x] 增加原因优先级 fixture：同一 result 同时含 `error`、失败 gate 和失败 soft，断言显示 `error`。
- [x] 增加多个失败 gate fixture，断言按原顺序全部保留；失败 soft 不出现在 failure reason。
- [x] 增加组统计 fixture：多个 experiment、多个 attempt、部分成本缺失、不同 `startedAt`，锁定 eval 级计票、总成本和最后运行时间。
- [x] 在 `src/view/view-report.test.ts` 保留并加强“裸跑 HTML 与显式 re-export `defaultReport` 完全一致”的测试。
- [ ] 在 `src/show/show.test.ts` 断言同一 fixture 的 text 数字与 view web 数字一致，而不是分别写两套期望公式。**阻塞原因**：等价的交叉断言测试已经写出并通过（`show --report 与 view --report 吃同一个报告文件，判定口径一致`），但落在 `src/view/view-report.test.ts`（复用该文件已有的 `runShow` + `loadViewScan` 夹具），不在字面指定的 `src/show/show.test.ts`；未搬动以避免引入本次违规修复清单之外的新改动。

验收：上述测试先能复现当前错误；实现完成后全部转绿。

## 2. 整理默认报告命名

推荐文件归属：

- `src/report/default-report.tsx`：小写值 `defaultReport: ReportDefinition`，即裸跑填充物。
- `src/report/official-report.tsx`：零 props 双面组件 `<DefaultReport />` 及其宿主注入数据；避免大小写同名文件在跨平台文件系统上冲突。

- [x] 把当前 `src/report/default-report-definition.tsx` 改名为 `src/report/default-report.tsx`。
- [x] 把当前 `src/report/default-report.tsx` 改名为 `src/report/official-report.tsx`。
- [x] 更新 `src/report/index.ts`、`src/show/index.ts`、`src/view/data.ts` 的 import/export。
- [x] 更新 `test/fixtures/report/default-report-reexport.tsx`。
- [x] 更新源码注释中的旧文件路径。
- [x] 更新 `docs/source-map.md` 的实现映射。
- [x] grep `docs/`、`docs-site/`、`memory/` 中的直接文件路径；设计文档改成当前路径，memory 只修会失效的源码链接，不改历史裁决内容。

验收：

```sh
rg -n "default-report-definition" src test docs docs-site memory
```

除明确讲历史文件名的 memory 外无命中。

## 3. 修正 RunOverview 通过率契约

- [x] 在 `src/report/types.ts` 的 `OverviewData.totals` 增加 `passRate: MetricCell`。
- [x] 在 `src/report/compute.ts` 的 `overviewData()` 中调用 `computeCell(passRate, items)`；不要从 `passed/failed/errored` 现场重算。
- [x] 保留 `passed` / `failed` / `errored` / `skipped` attempt 计数，它们是独立的运行概况，不是通过率公式输入。
- [x] 修改 `src/report/react/RunOverview.tsx`，只渲染 `data.totals.passRate.display`，并复用 `MetricCell` 的缺数据/覆盖率提示。
- [x] 修改 text face，输出同一 `MetricCell.display` 和必要的覆盖率说明。
- [x] 更新所有手工构造 `OverviewData` 的 fixture。
- [x] 更新 `OverviewData` 的 TSDoc 与 `docs/reports.md` 类型块。
- [x] 运行 `pnpm docs:reference` 更新生成区块，禁止手改 generated region。

验收：当两个 eval 的 attempt 数不同或有 partial credit 时，Overview 与 `MetricTable.data(... passRate)` 仍显示相同通过率。

## 4. 提取通用组统计

新增公开组件数据契约：

```ts
interface GroupSummaryData {
  experiments: number;
  evals: number;
  attempts: number;
  verdicts: {
    passed: number;
    failed: number;
    errored: number;
    skipped: number;
  };
  passRate: MetricCell;
  totalCostUSD: number | null;
  lastRunAt?: string;
}
```

- [x] 在 `src/report/types.ts` 增加 `GroupSummaryData`。
- [x] 在 `src/report/compute.ts` 提取内部纯函数 `summarizeItems(items)`，集中计算 eval 级折叠计票、数量、标准通过率、总成本和最近运行时间。
- [x] 统计 eval 时使用完整身份键，避免两个 experiment 中同名 eval 被错误合并。
- [x] `totalCostUSD` 只累加可测成本；全缺时返回 `null`，不得返回 `0`。
- [x] `lastRunAt` 从实际参与统计的 item/snapshot 中取最大值；不得读取 view hero 的全局最新值。
- [x] 让现有 `experimentRowMeta()` 复用相同的 eval 级统计实现，删除重复的 `evalLevelStats(...)` 拼装。
- [x] 通过 `GroupSummary.data(input)` 暴露能力；不要公开内部 `Item` 或 `summarizeItems()`。
- [x] 在 `src/report/components.tsx` 导出 `GroupSummary`，并挂载 `.data`，保持现有 `Xxx.data` 命名规范。
- [x] 从 `niceeval/report` 公开导出类型和组件。

验收：默认报告和用户自定义报告都能只用公开 API 原样生成同一组摘要。

## 5. 实现 GroupSummary 双面组件

- [x] web face 使用紧凑摘要块，至少显示：通过率、experiment/eval 数、failed、errored、总成本、最后运行时间。
- [x] errored 为 0 时可省略该片段，但数据字段不得省略。
- [x] text face 输出一至两行可读文本；窄终端允许自然换行，不依赖固定网格宽度。
- [x] 两面都使用 `GroupSummaryData.passRate.display`，不得再次计算比例。
- [x] 时间格式走 report locale；不得复用 view app 专用 i18n/format 模块。
- [x] 在 `src/report/locale.ts` 同时添加 en 与 zh-CN 文案，优先复用已有 Verdict 和计数 key。
- [x] 在 `src/report/react/styles.css` 添加组件局部样式；不要整体复制旧 `.group-selector` CSS。
- [x] 给缺成本、零失败、存在错误、中文 locale 各补一条双面渲染测试。

## 6. 校准 failure reason / score summary

目标优先级：

```text
error
→ skipReason
→ 所有未通过的 gate assertions（保持声明顺序）
→ 无失败原因
```

- [x] 在中性共享层提取原因摘要纯函数，供 `ExperimentTable`、`MetricTable expand`、`CaseList` 和 `<DefaultReport />` 的 failing board 共用。
- [x] 不允许 `src/report/compute.ts` 与 `src/report/official-report.tsx` 各自再写 `.find(a => !a.passed)`。
- [x] gate 文案保留 name 与 detail；多个 gate 用稳定分隔符连接。
- [x] soft assertion 不进入 failure reason。
- [x] `ExperimentTable` 的 passed attempt soft 得分使用独立 `scoreSummary?: string`，不塞进 `reason`。
- [ ] 如果新增 `TableSubRow.scoreSummary`，同步 web/text face、类型、TSDoc 和参考文档。**阻塞原因**：依赖上一项，`scoreSummary` 未新增，此项不适用。
- [x] errored/skipped 没有 assertion 时仍分别显示 `error`/`skipReason`。

验收：`MetricTable` 展开行、`CaseList` 和 `<DefaultReport />` failing board 对同一 attempt 给出同一原因。

## 7. 重组 defaultReport

- [x] 把默认报告内的组装拆为三个无副作用 helper：计算 group keys、计算单组 data、生成单组 nodes。
- [x] 每个命名组渲染 `Section → GroupSummary → 可选 MetricScatter → ExperimentTable`。
- [x] 无分组实验直接渲染相同 blocks，不创建 `Ungrouped`/`Other` 等虚构标题。
- [x] scatter 仍只在至少两个点的 x/y 都可测时出现。
- [x] `ExperimentTable` 默认按 `passRate` 降序预排，web 面支持列排序与过滤；整行展开配置、KPI、逐 Eval/Attempt 和 raw sample。
- [x] 表格继续携带 agent/model/Verdict 元信息。
- [x] 为 experiment 主行补回 eval 数、attempt 数和最后运行时间；优先扩充通用 `TableRowMeta`，不要读取 view 私有模型。
- [x] 新增字段必须对所有行维度语义成立；若只对 `rows: "experiment"` 成立，应明确放在 experiment meta 分支并在类型/TSDoc 中说明。
- [x] 不恢复 config chips、raw JSON sample 或 React modal 状态；证据详情继续通过 AttemptRef 深链进入 view 证据室。

## 8. 核对 MetricScatter 与旧图正确行为

- [x] 确认每个 experiment 一个点，x=`costUSD`、y=`passRate`、series=`agent`。
- [x] 确认缺任一轴数据的点不画，并在 web/text 注脚如实计数。
- [x] 确认成本轴“越便宜越好”的方向与 `better: "lower"` 一致。
- [x] 确认 y 轴在所有通过率相同时不会产生除零或 NaN。
- [x] 确认 label/tooltip 同时包含 experiment、agent/model、成本、通过率。
- [x] 只修与旧正确行为不一致的部分；不要把旧 `CostScoreChart` 整文件复制回来。

## 9. 文档同步

- [x] 先重写 `docs/reports.md` 受影响小节：`OverviewData`、`GroupSummary.data`、failure reason 契约、`defaultReport` 最终形态。
- [x] 更新 `docs/source-map.md` 的文件与组件映射。
- [x] 更新 `docs/view.md`：所有组同时显示、无分组实验直接显示、组摘要包含哪些信息。
- [x] 更新 `docs-site/zh/guides/report-components.mdx`，说明 `GroupSummary` 的使用方式。
- [x] 更新 `docs-site/zh/guides/custom-reports.mdx`，给出用户用公开 API 复刻组块的短示例。
- [x] 更新 `docs-site/zh/guides/viewing-results.mdx` 中默认报告的最终可见信息。
- [x] 不在 docs/docs-site 写 d0b6718、旧版、新版或迁移过程；这些过程只写 memory。
- [x] 新增一条 memory，记录“视觉搬迁前必须建立行为矩阵；face 不得重算 compute 指标”的现象、根因与修法，并在 `memory/INDEX.md` 索引。

## 10. 执行与验证

执行者按以下顺序工作，每完成一项再勾选：

- [x] 阅读 `AGENTS.md`、`docs/README.md`、`docs/source-map.md`、`memory/INDEX.md`。
- [x] 改 `docs-site/` 前阅读 `docs-site/AGENTS.md`。
- [x] 用 `git status --short` 识别并保留用户已有改动；不得覆盖无关文件。
- [x] 先补第 1 节测试并确认它们能暴露当前错误。
- [x] 完成第 2 节文件改名，立即用 `rg` 扫旧路径。
- [x] 完成第 3–6 节计算契约和双面组件。
- [x] 完成第 7–8 节默认报告编排与图表校准。
- [x] 先写定稿 docs，再同步公开中文文档；英文入口不在本任务内临时发明新内容。
- [x] 运行类型检查：

  ```sh
  pnpm run typecheck
  ```

- [x] 运行完整测试：

  ```sh
  pnpm test
  ```

- [x] 公开类型/TSDoc 变化后重新生成参考页，再跑测试检查漂移：

  ```sh
  pnpm docs:reference
  pnpm test
  ```

- [ ] 冒烟 text 面：**阻塞原因**：本仓库根目录下没有 `.niceeval` 结果数据（`find` 未命中任何 `.niceeval` 目录）；执行 `pnpm run niceeval -- show` 直接报 `No results found under .../.niceeval`，按本节允许的兜底记录为未执行，不伪造成功。

  ```sh
  pnpm run niceeval -- show
  ```

- [ ] 用仓库现有 fixture/结果目录冒烟 web 面；若没有可读 `.niceeval` 数据，记录为未执行，不伪造成功：**阻塞原因**：同上——仓库没有可读 `.niceeval` 结果目录，`view --out` 同样无法产出真实数据的冒烟结果，记录为未执行。

  ```sh
  pnpm run niceeval -- view --out /tmp/niceeval-view
  ```

- [x] 校验公开文档：

  ```sh
  PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
  PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
  ```

- [x] 最后运行 `git status --short` 和 `git diff --check`。
- [x] 对照本文件逐项勾选；任何未完成项写明阻塞原因，不得用“基本完成”代替。

## 完成定义

- [x] Overview、组摘要、Experiment 表和逐 eval 明细在 web/text 两面数据同源。
- [x] 三处语义漂移均有回归测试：Overview passRate、failure reason 过滤/优先级、组内 eval 级统计。
- [x] 两处信息损失均恢复：组汇总信息、experiment/eval 展开上下文。
- [x] 所有组和无分组实验都可见。
- [x] `defaultReport` 仍能由外部报告作者仅使用 `niceeval/report` 公开面逐字复刻。
- [x] `validateReportTree` 规则未放宽，默认报告没有特权分支。
- [x] typecheck、test、reference drift、docs validate、docs links 全部通过，或明确记录无法运行的外部环境原因。
