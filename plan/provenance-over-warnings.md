# 时效与覆盖:从页面级警告改为行级事实(provenance over warnings)

设计已定稿并落进 docs(见下「契约落点」);本篇给实现 Agent 列执行项。裁决背景见 memory 条目 `staleness-demoted-from-warning-to-provenance`。

## 一句话

「有效但旧」(携带、跨快照拼接)与「覆盖缺口」是**行级事实**,从 ScopeWarnings 撤出:时效变成 attempt/行上的 `↩` 标注,覆盖缺口变成 `scope.coverage` 数据与榜单占位行;warnings 只留定位不到行的 kind(`unfinished-snapshot` / `missing-startedAt` / `unreadable-snapshot`)。新增 `fresh` 口径(库选项 + `--fresh` flag)只看新执行。

## 契约落点(实现对照的单源)

- `docs/feature/results/library.md` —— `attempt.carried`、`scope.coverage`(`knownEvalIds` / `missingEvalIds`)、警告 kind 全集(缩到三种)、「时效:新执行与历史执行」新节(historical 判定 + `fresh: true`)、filter 同步修剪 coverage。
- `docs/feature/reports/library/entity-lists.md` —— `AttemptListItem.startedAt/historical`、`ExperimentListItem.historicalAttempts/missingEvalIds`、「时效标注」共享规则、ExperimentList 占位行与副行 `6/8 evals` + `↩ n/m attempts`。
- `docs/feature/reports/library/site-components.md` —— ScopeWarnings 收缩(组排序改「实验组在前、kind 组在后」,类别两档制删除)。
- `docs/feature/reports/show.md` / `view.md` —— `--fresh` flag。
- `docs/feature/reports/show/default-report.md` —— text 面示例(↩ 标注、占位行、副行分母)。
- `docs/error-feedback.md` —— Scope 警告例子行与三段式「依据」示例已换。
- 覆盖规范:`docs/engineering/testing/unit/results.md`(Scope/current/时效与 fresh 三条)、`reports.md`(数据计算函数、站点组件、宿主装载等价三条)。

## 执行项(按依赖顺序)

1. **results 读取面**:`AttemptHandle.carried`(artifactBase 投影);Scope 增加 `coverage`;`latest()` / `current()` 增加 `fresh` 选项;删除 `partial-coverage` / `stale-snapshot` 的产出;`filter` 修剪 coverage。类型在 `src/results/types.ts`,选择逻辑在 `src/results/select.ts`。
2. **reports 数据层**:`attemptListData` 补 `startedAt` / `historical`(historical = carried ∥ 所属快照早于该实验在 Scope 中最新快照);`experimentListData` 补 `historicalAttempts` / `missingEvalIds`(消费 `scope.coverage`),占位行不进任何指标聚合。
3. **渲染面**:ExperimentList 两面的占位行、副行分母与 `↩` 标注;AttemptList/EvalList 行的 `↩` 标注(人话时距与 stale-snapshot 旧 message 同一套时距函数可复用);ScopeWarnings 删类别排序、按新组排序。改动涉及 `src/report/**` 需要 `pnpm run build:report`。
4. **CLI**:show / view 增加 `--fresh`(`src/cli.ts` FLAG_OPTIONS,带 JSDoc,i18n 两份 `--help` 速查酌情点名);与 `--snapshot` 组合语义按「口径作用于 Scope 构建」自然成立,无需特判。
5. **测试**:按两份覆盖规范新声明的类别写;旧 partial-coverage / stale-snapshot 断言删除或改写为 coverage / historical 断言。
6. **同步义务**:公开面变了跑 `pnpm docs:reference`;`docs/source-map.md` 的 ScopeWarning 四种描述行更新;英文 docs-site 入口**本次明确不动**(用户指示,后续按中文核对同步)。
