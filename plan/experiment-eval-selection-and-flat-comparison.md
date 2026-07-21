# Handoff：EvalDescriptor 选题与扁平实验报告落地

产品契约已在 `9861772`（`docs: simplify experiment eval selection`）与 `ba9c5a4`（`docs: show eval path predicate selection`）定稿。实现以这些文档为准：

- `docs/feature/eval/README.md`、`docs/feature/eval/library.md`
- `docs/feature/experiments/README.md`、`library.md`、`architecture.md`、`cli.md`
- `docs/feature/results/architecture.md`、`library.md`
- `docs/feature/reports/architecture.md`、`library/summaries.md`、`library/entity-lists.md`

当前代码**尚未满足契约**。不要再引入 `comparisonGroup`、`group` 配置或按目录分报告的兼容层；niceeval 仍处 beta，直接把公共 API 改到目标形态。

## 目标不变量

```ts
interface EvalDescriptor {
  readonly id: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly environment?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface ExperimentDef {
  evals?: "*" | readonly string[] | ((eval: EvalDescriptor) => boolean);
}
```

```ts
interface ExperimentComparisonData {
  summary: ScopeSummaryData;
  scatter: ScatterData;
  experiments: ExperimentListItem[];
}
```

必须同时成立：

1. `eval.id` 是 `evals/` 下路径推导出的逻辑 id；任意深度和数据集扇出都已完成，不暴露绝对路径、`sourcePath`、`baseDir`、`test` 或 hooks。
2. 每个 experiment 的谓词对本次 invocation 的候选 eval 各求值一次；CLI 的尾随 eval 前缀再与它取交集。之后 dry-run、sandbox、并发、fingerprint、carry、attempt 展开和报告都不得再次执行用户谓词。
3. 求值结果成为唯一的 `selectedEvalIds`，先进入内部 resolved run，再进入 `ExperimentRunInfo` 与 `snapshot.json`。报告不 import experiment 文件、不重跑函数。
4. `selectedEvalIds` 是选题边界；`knownEvalIds` 继续只是历史覆盖完整性的依据。两者不能互相替代。
5. 默认 `ExperimentComparison` 对当前 Scope 只算一份 summary、scatter 和 experiment list。目录只生成 id 并支持 CLI 批量选择，不生成比较组、tab、panel 或 text 组索引。
6. 默认散点中，Scope 任一 experiment 声明 `labels.line` 时使用 `label("line")` 并默认连线，否则按 `agent` 且默认不连线。`labels.line` 不是 comparison group。
7. 未选择的 eval 不进入该 experiment 的计算，也不补成失败；已选择但没有 attempt 的项同样不得伪造失败。运行不完整由现有 completion / Scope warning 表达。
8. 没有 `ExperimentRunInfo.selectedEvalIds` 的第三方快照按其实际 `snapshot.evals` 退化，不能把第三方结果全部过滤掉。

## 当前差距

| 契约 | 当前实现 | 主要落点 |
|---|---|---|
| 谓词收到 `EvalDescriptor` | 收到裸 `id: string` | `src/runner/types.ts`、`src/cli.ts` |
| 公开导出 `EvalDescriptor` | 类型不存在 | `src/index.ts` |
| 谓词只求值一次 | CLI、sandbox、fingerprint、runner 多次调用 `run.evalFilter(id)` | `src/cli.ts`、`src/runner/run.ts`、`fingerprint.ts`、`sandbox-selection.ts` |
| 路径无比较组语义 | discovery 仍写 `DiscoveredExperiment.group`，CLI/反馈仍称 group | `src/runner/discover.ts`、`src/cli.ts`、`src/i18n/*`、`src/runner/feedback/*` |
| `selectedEvalIds` 驱动报告 | 字段已落盘，但 report 聚合完全不读 | `src/runner/attempt.ts`、`src/report/*` |
| `current()` 合成快照选题自洽 | 直接复制最新快照的 experiment 信息 | `src/results/select.ts` |
| 默认报告扁平 | 按 experiment 父目录生成 `groups[]` | `src/shared/aggregate.ts`、`src/report/types.ts`、`compute.ts`、两套 renderer |
| 无组 UI | 仍有 group tab、panel、JS 切换、CSS 与 locale | `src/report/react/*`、`src/report/text/faces.ts`、`src/report/locale.ts` |

已经可复用的部分：eval discovery 已支持任意深度与数组/record 扇出；`EvalDef` 已有 `description`、`tags`、`environment`、`metadata`；`ExperimentRunInfo.selectedEvalIds`、writer/reader 格式与 `labels.line` 已存在。不要重造第二份结果字段。

## 0. 先登记测试场景

按仓库“先登记后写测”规则，先改 cases 表，再写测试：

- `docs/engineering/testing/unit/experiments-runner.md`
  - 把现有选题行补全为：谓词同时读取 `id.startsWith("coding/")`、`tags`、`environment`、`metadata`；收到的对象不含内部路径/执行字段；每个 experiment × eval 只求值一次；尾随前缀与谓词取交集；非法非 boolean 返回和抛错都带 experiment id + eval id。
  - 把“`exp <组>`”等用语改成“目录路径批量选择”，不改变选择器规则。
- `docs/engineering/testing/unit/results.md`
  - 新增：`current()` 合成 q1 新快照 + q2 旧快照后，合成快照的 `selectedEvalIds` 等于实际 picks；来源快照中不在其 `selectedEvalIds` 的异常 attempt 不进入合成结果；缺字段的第三方快照退化为实际 eval 集。
- `docs/engineering/testing/unit/reports.md`
  - 补充已有 `experimentComparisonData()` 场景：不同深度目录的 experiments 仍进同一份 data；每个 experiment 只保留自己选择的 eval；缺字段第三方快照可见。
  - web/text 场景明确断言无 `role=tablist`、无 group 命令、experiment 显示完整 id。

## 1. 建立公开 descriptor 与纯选题边界

### 类型

在 `src/runner/types.ts`：

- 新增并导出 `EvalDescriptor`，字段与 docs 完全一致且全部 readonly。
- `ExperimentDef.evals` 改成 `"*" | readonly string[] | ((eval: EvalDescriptor) => boolean)`。
- `DiscoveredExperiment` 删除 `group`。
- 内部 `AgentRun` 删除 `evalFilter`，把 `selectedEvalIds` 改成必填 `readonly string[]`；不得以 optional + fallback 掩盖未解析状态。
- `src/index.ts` 公开导出 `EvalDescriptor`。

在 `src/runner/eval-selection.ts` 新建纯模块，集中放两件事：

```ts
function evalDescriptorOf(evalDef: DiscoveredEval): EvalDescriptor;

function resolveExperimentEvals(input: {
  experimentId: string;
  selector: ExperimentDef["evals"];
  cliPatterns: readonly string[];
  evals: readonly DiscoveredEval[];
}): {
  selectedEvals: readonly DiscoveredEval[];
  selectedEvalIds: readonly string[];
};
```

实现要求：

- descriptor 是显式白名单投影，绝不能把 `DiscoveredEval` 原对象直接传给用户。
- `tags` 缺省为 `[]`；拷贝并冻结 tags，descriptor 与 metadata 至少浅冻结，防止一个 experiment 的谓词污染另一个。不要深冻用户 metadata 中的任意类实例。
- 数组形态沿用 eval id 裸前缀语义；`"*"` / `undefined` 全选；CLI patterns 最后取交集。
- 谓词按 discovery 稳定顺序同步调用。返回值不是 boolean 时立刻报配置错误；Promise 不能按 truthy 接受。错误包含 experiment id 与当前 eval id，并保留 cause。
- 返回顺序保持 discovery 顺序，ID 去重；这是 dry-run、attempt 顺序与 `selectedEvalIds` 落盘的共同来源。

`fingerprintEvalsFilter` 可移入此模块，继续记录数组内容 / 函数体 / CLI patterns 的审计指纹；指纹不能参与报告选题，也不能替代 `selectedEvalIds`。

## 2. CLI 只解析一次，Runner 只消费结果

在 `src/cli.ts`：

1. discovery 与 experiment 选择完成后，对每个 experiment 调一次 `resolveExperimentEvals()`。
2. 用返回值构造 `AgentRun.selectedEvalIds`，并用同一份 `selectedEvals` 生成 `matchedByRun`、dry-run 行、总 attempt 数与 unique eval 数。
3. 删除 `evalsFilterFromExperiment()`。不得在后续阶段保存用户 predicate。
4. 零命中仍走既有 CLI 用法错误，不派发 attempt；内部 resolved 结果应为 `selectedEvalIds: []`，但不要为了记录空选择而伪造成功快照。

在 runner 内提供一个简单 helper：

```ts
function selectedEvalsForRun(
  all: readonly DiscoveredEval[],
  run: Pick<AgentRun, "selectedEvalIds">,
): DiscoveredEval[];
```

所有消费者只按 resolved ID 取 eval：

- `src/runner/run.ts`：attempt 展开、judge 预检、reporter scope、排序、hook ctx。
- `src/runner/fingerprint.ts`：`planCarry()`。
- `src/runner/sandbox-selection.ts`：environment 缺项检查、逐 eval spec、推荐并发。
- CLI 中 carry plan、resolved sandbox 与 dry-run 的所有调用点。

删除 `runEvals()` 里重新写 `run.selectedEvalIds = ...` 的逻辑。`experimentRunInfo()` 直接投影必填 resolved IDs；`ExperimentHookContext.selectedEvalIds` 与快照必须引用同一有序值集。

这一步的回归重点不是“谓词函数能选中”，而是给谓词加调用计数后，完整 dry + real planning 链路仍严格等于 `实验数 × 候选 eval 数`，sandbox/fingerprint/run 不增加次数。

## 3. 删除“路径就是组”的运行时残留

### Discovery 与 CLI 文案

- `src/runner/discover.ts` 不再生成 `group`。
- 保留 `matchExperimentSelector()`：精确 id → 任意深度目录路径 → 同目录文件名前缀。它是运行选择，不是报告分组。
- CLI 零命中目录清单从 experiment ids 推导所有可浏览父路径，显示 docs 已定稿的 `Available paths: agents/, suites/, ...`；变量名不要再叫 `availableExperimentGroups`。
- 同步 `src/i18n/en.ts`、`src/i18n/zh-CN.ts`：help、noMatch、noEvalsSelected、run hint 中的 group/config 改为 path/experiment，对齐 `docs/feature/experiments/cli.md`。
- 更新 `test/e2e-cli-output-profiles.test.ts` 的旧 `Available groups` 断言。

### 运行完成反馈

`src/runner/feedback/human.ts`、`agent.ts`、`ci.ts` 仍从快照路径第一段推导“共同 group”。删除这项语义：

- human 的比较命令直接是 `niceeval view`，不把目录路径误放进 view 的 eval 位置参数。
- agent 失败截断提示改为 `run \`niceeval view\``（需要实验过滤时用户显式用 `--exp`）。
- CI 多快照路径只显示 `<N snapshots>` 或真实路径，不用父目录折叠成比较组。
- 删除对应 `deriveResultGroup()` 副本、i18n 插值与旧测试断言。

这里不能删除目录批量选择，也不能把目录改造成一个隐藏的 `comparisonGroup`。

## 4. 让 `results.current()` 的合成快照记录自己的选题集

在 `src/results/select.ts` 增加内部 helper：

```ts
function selectedEvalIdsOf(snapshot: Snapshot): readonly string[] {
  return snapshot.experiment?.selectedEvalIds ?? snapshot.evals.map((eval) => eval.id);
}
```

`selectCurrentResults()` 逐 eval 回填时：

- 一个来源快照只允许贡献它自己 `selectedEvalIds` 中的 eval；第三方无字段时按实际 `snapshot.evals` 退化。
- q1 来自新快照、q2 来自旧快照时，合成快照的 `experiment.selectedEvalIds` 必须重建成最终 picks 的有序 id 列表，不能照抄最新快照的局部选择。
- 其余 experiment 运行配置仍取可比性基准快照；`selectedEvalIds` 继续不参与 `comparabilityConfigOf()`。
- `knownEvalIds` 与 partial-coverage 算法保持原职责，不改成 selected set。

如果 `base.experiment` 缺失，不要为了 selected IDs 伪造一份不完整 `ExperimentRunInfo`；第三方 snapshot 继续靠 report 侧 fallback。

## 5. 默认报告先按落盘选题投影，再扁平计算

不要全局修改 `collectItems()`：自定义 `MetricTable`、`Scoreboard` 等组件仍应忠实消费作者传入的 Scope。选题投影只属于默认 `ExperimentComparison` 契约。

在 `src/report/compute.ts` 为默认比较建立内部投影：

```ts
function comparisonSnapshots(snapshots: readonly Snapshot[]): Snapshot[];
```

每个 snapshot：

- 有 `experiment.selectedEvalIds` 时，只保留集合内的 `evals` 与 `attempts`。
- 无字段时保留实际 eval/attempt（第三方 fallback）。
- 不修改输入对象、不造 verdict、不为空缺 eval 造 attempt。
- 保持 attempt handle、ref、snapshot identity 可下钻；若复制 snapshot，需要确保 handle 的反向引用不会被错误用于 dedupe。优先复用现有 handle，仅投影容器。

然后删除：

- `experimentComparisonGroupKey()`。
- `snapshotsByGroup` 与 `ExperimentComparisonGroupData`。
- `experimentGroupOf()` 的 import 与使用。

`experimentComparisonData()` 对投影后的完整 Scope 只执行一次：

```ts
const series = options?.series ?? comparisonSeriesFor(allSnapshots);
const [summary, scatter, experiments] = await Promise.all([
  scopeSummaryData(allSnapshots),
  metricScatterData(allSnapshots, {
    points: "experiment",
    series,
    x: costUSD,
    y: endToEndPassRate,
  }),
  experimentListData(allSnapshots),
]);
return { summary, scatter, experiments };
```

`comparisonSeriesFor()` 改成检查完整 Scope：任一 snapshot 有 `labels.line` 即全图使用 line；显式 `series` 覆盖默认值。

在 `src/report/types.ts`、`src/report/index.ts`、`src/report/react/index.tsx`：

- `ExperimentComparisonData` 改成扁平三字段。
- 删除 `ExperimentComparisonGroupData` 的定义与公共导出。
- 删除 `experimentGroupOf` 的公共导出；若全仓无其它使用，从 `src/shared/aggregate.ts` 删除函数。
- `experimentDisplayName(relativeTo?)` 继续保留给自定义报告显式使用，但注释删除“默认组面板”；默认 comparison 不传 `relativeTo`。

数据形状变化是报告 library 的 beta 破坏性变更，不提供 `{ groups }` 兼容解析。`validateComparisonData()` 应明确拒绝旧数据形状并沿用版本漂移提示。

## 6. Web 与 text 都直接渲染完整 Scope

### Web

`src/report/react/ExperimentComparison.tsx` 只渲染：

```tsx
<ScopeSummary data={data.summary} />
<MetricScatter
  data={data.scatter}
  connect={connect ?? data.scatter.seriesDimension === "line"}
/>
<ExperimentList data={data.experiments} filter />
```

- 空 experiments 显示 `No experiments / 暂无实验`。
- 不渲染 tablist、group card、group `<details>`、group data attributes。
- 不向 `ExperimentList` 传 `relativeTo`，完整 experiment id 必须可见。
- `src/report/react/enhance.js` 删除实验组切换行为并更新文件头行为数量。
- `src/report/react/styles.css` 删除仅供 group tabs/panels 的样式，保留三个普通子组件之间必要的垂直间距即可。

### Text

`src/report/text/faces.ts` 删除 `comparisonGroupText()` 与多组索引/命令表，始终按以下顺序输出：

1. `scopeSummaryText(data.summary, "eval", ctx)`
2. `scatterText(data.scatter, ctx, { connect })`
3. `experimentListText(data.experiments, ctx)`

空 data 使用与 web 同一 locale key。不要缩短 experiment id，也不要提示 `niceeval exp <group>`。

### Locale 与组件说明

- `src/report/locale.ts` 删除只服务 group UI 的 `groups`、`group`、`selectGroup`、`commandsHead`、`results`、`lastRun` keys；保留并改写 `experimentComparison.empty`。
- `src/report/components.tsx` 的 TSDoc 和 `ComparisonChrome.connect` 注释改成完整 Scope 语义。
- 更新 `src/report/react/fixtures.ts` 及所有手写 `ExperimentComparisonData` fixture。

## 7. 测试实现

### Runner / public API

优先新增 `src/runner/eval-selection.test.ts` 测纯解析边界：

- descriptor 的 `id` 可做 `startsWith("coding/")`，并同时读 tags/environment/metadata。
- 数组/record 扇出后的最终 id 传给谓词。
- 未声明 tags 得到只读空数组；不暴露 `sourcePath`、`baseDir`、`source`、`test`。
- mutation 不影响后续 experiment；非 boolean / Promise / throw 给完整错误上下文。
- `"*"`、readonly 前缀数组、CLI patterns 交集与稳定顺序。

在 `src/define.test.ts` 或独立类型守护里从公开入口 import `EvalDescriptor`，让 `defineExperiment({ evals: eval => ... })` 的参数完成正确推断。不要用运行时断言代替 `pnpm typecheck`。

更新 `src/runner/run.test.ts`、`fingerprint` / `sandbox-selection` 相关测试 fixture：所有 `AgentRun` 显式给 `selectedEvalIds`，删除 `evalFilter: () => true`。增加一次端到端计数测试证明 sandbox + fingerprint + run 不能重执行 predicate。

### Results

在 `src/results/results.test.ts` 覆盖：

- writer → reader round-trip 保留有序 `selectedEvalIds`。
- `current()` 局部补跑合成后的 selected IDs 与 picks 一致。
- 恶意/历史快照中实际 attempt 不在声明 selected set 时不进入默认比较所用的合成结果。
- 第三方无 experiment 信息时仍能读、能报。

### Reports

重写 `src/report/report.test.ts` 旧分组测试：

- 输入 `compare/a`、`bench/long/x`、`standalone`，返回一个扁平 data；三子块分别与对完整投影 input 单独调用深等。
- experiment A 声明 `selectedEvalIds: ["q1"]` 但夹带 q2 attempt，B 只选 q2；A/B 各自统计且 q2 不污染 A。
- Scope 任一 snapshot 有 `labels.line` 时整张 scatter 的 `seriesDimension === "line"`；完全无 line 时为 agent；显式 series 覆盖。
- 旧 `{ groups: [...] }` data 形态被 validator 拒绝。

在 `src/report/dual-render.test.tsx` 或对应 render 测试断言：

- web/text 同时出现 summary、scatter、experiment list。
- web 无 tablist / group selector attributes，text 无 group index / `niceeval exp <group>`。
- `compare/a` 与 `bench/long/x` 显示完整 id。
- 0/1/多 experiment 均可渲染。

删除只证明旧 group 行为的测试，不保留“先分组再验证没串数据”这种反契约覆盖。

## 8. 验证顺序

先跑最小边界，再跑全仓：

```sh
pnpm exec vitest run src/runner/eval-selection.test.ts src/runner/discover.test.ts
pnpm exec vitest run src/runner/sandbox-selection.test.ts src/runner/run.test.ts
pnpm exec vitest run src/results/results.test.ts
pnpm exec vitest run src/report/report.test.ts src/report/dual-render.test.tsx
pnpm exec vitest run test/e2e-cli-output-profiles.test.ts
pnpm run typecheck
pnpm test
```

公共 API、CLI、Results Format 与默认报告均有变化，再补两条黑盒验收：

```sh
pnpm e2e --repo cli-contract
pnpm e2e --repo results-contract
```

`cli-contract` fixture 至少放两边都有出处的 eval：

- `evals/coding/fix-button.eval.ts`：`tags: ["coding", "frontend"]`、`environment: "node-22"`。
- `evals/research/gpu-literature.eval.ts`：`tags: ["research"]`、`environment: "gpu"`。
- experiment predicate 使用 `eval.id.startsWith("coding/") && eval.tags.includes("coding") && eval.environment !== "gpu"`。

验收读取 `snapshot.json`，断言只记录 `coding/fix-button`；再用同一结果根运行 `show` 与 `view` 的已有 contract 检查，确认不同目录 experiments 同时出现在一份默认比较里且无 group selector。不得依赖真实模型 key；使用 contract repo 的 fake agent/provider。

如果新增 `src/runner/eval-selection.ts`，同步 `docs/source-map.md` 的 Experiments/Runner 定位。公共 docs 契约已经定稿，除实现暴露新的歧义外不要回改成当前代码行为。

## 完成判据

- 下游 TypeScript 能从 `niceeval` import `EvalDescriptor`，谓词参数正确推断并可按 path/tags/environment/metadata 选择。
- 用户谓词在完整规划与执行链中每 experiment × candidate eval 恰好调用一次。
- dry-run、sandbox lookup、fingerprint、carry、attempt、hook ctx 与 snapshot 的 selected IDs 完全一致。
- 任意深度 experiment 目录只影响 id/CLI 选择；源码与输出中没有 `DiscoveredExperiment.group`、`ExperimentComparisonGroupData`、`experimentGroupOf` 或 group UI。
- `results.current()` 合成快照的 `selectedEvalIds` 与其实际 picks 自洽。
- 默认 report 的 data 是扁平三字段，web/text 都展示完整 Scope；不同 experiment 的不同 eval 集不求交集、不补失败。
- 上述 targeted tests、`pnpm run typecheck`、`pnpm test`、两个 contract E2E 全绿。

## 协作注意

仓库直接在 `main` 上多人共享。实现前先看 `git status`；只提交本计划涉及的显式路径，不要把 `docs/engineering/testing/e2e/**`、`test/e2e-structure.test.ts`、`vitest.config.ts` 等现有并行改动夹带进 commit。
