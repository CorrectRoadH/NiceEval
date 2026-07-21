# Reports 的测试用例

本页是 Reports 数据语义的场景登记表。fixture 形状见 [测试架构](README.md)；渲染面（终端排版、DOM 结构、双面比对、视觉交互）与读面 CLI 行为的验收计划见 [E2E 功能域 · 报告与读面](../../e2e/report.md)，不在本表登记。

## 指标聚合口径

契约来源：[Architecture](../../../../feature/reports/architecture.md)、[Library · 指标与维度](../../../../feature/reports/library/metrics.md)。

| 契约 | 场景 |
|---|---|
| 一般指标先在同一 eval 的多个 attempt 内折叠、再跨 eval 折叠（两级默认均 mean），重试次数不改变题目权重 | 正例：区分力 fixture 的 `endToEndPassRate` 得 5/9；反例：区分条件任务通过率 5/6、attempt 平铺 3/5 与"任一轮通过"2/3 三种错误口径 |
| 无限定词的通过率与默认组件使用 `endToEndPassRate`：errored = 0；可见短标签为“Pass rate / 通过率”；`taskPassRate` 排除 errored，只能作为带限定名称的诊断指标 | 正例：2 passed + 5 errored 的默认通过率是 2/7，不是 100%；正例：并排展示三个指标可区分任务质量与执行可靠性 |
| `skipped` attempt 对全部内置指标返回 `null`，不进有效样本但保留在 total | 正例：samples < total 且 value 不受影响；反例：skipped 未被算成 0 分 |
| `null` 表示测不了不参与聚合；`0` 正常参与，二者聚合结果必须不同 | 边界：`[null, 0, 1]` 的 mean 是 0.5 而非 1/3 |
| `Scoreboard` 使用固定题集分母：未跑到的题按 0 分计入分母并计入 `notRun`；跑了但指标为 null 的题同样按 0 分但计入 `unscorable`，两个计数不合并 | 正例：题集 4 只跑 2 分母仍 4 且 notRun=2；正例：跑了但 null 的题 unscorable+1 而 notRun 不变；反例：与"只统计有样本"口径区分 |
| `Scoreboard` 权重按 eval id 前缀匹配，多前缀命中取最长 | 正例：`security/` 与 `security/auth/` 同时命中取后者；边界：无命中 |
| 跨快照计算先按 attempt 身份键去重，同一 attempt 出现在多快照不重复计数 | 正例：局部补跑重叠快照下 samples 不虚增 |
| 宿主 Scope 为每个 experiment × eval 选择跨历史最新判定 | 正例：先 failed 后 passed 的两快照只用最新判定 |
| 自定义指标 `where` 是进入计算前的过滤；`aggregate: { perEval, acrossEvals }` 两级分别生效 | 正例：failed attempt 不进聚合；边界：全被 where 排除 → missing；正例：perEval min + acrossEvals mean 与双 mean 可区分 |
| `evalGroup` 维度按 eval id 完整父路径分组（无 `/` 取完整 id）；只组织 eval；Scoreboard `subject` 缺省同规则 | 正例：`a/b/c` 归 `a/b`；边界：无斜杠 id 形成单例组 |
| 报告消费落盘 verdict，不重新判卷 | 反例：断言明细与 verdict 故意矛盾时以 verdict 为准 |

示例——先测 `*Data` 计算的事实：

```tsx
import { expect, it } from "vitest"
import { scopeSummaryData } from "../../report/index.ts"

it("scopeSummaryData 使用端到端两级聚合并保留覆盖率", async () => {
  const data = await scopeSummaryData(scope)

  expect(data.endToEndPassRate.value).toBeCloseTo(5 / 9)
  expect(data.endToEndPassRate.display).toBe("55.6%")
  expect(data.endToEndPassRate.samples).toBe(5)
  expect(data.endToEndPassRate.total).toBe(6)
})
```

## MetricCell 与缺数据行为

契约来源：[Architecture](../../../../feature/reports/architecture.md)、[Library 总览](../../../../feature/reports/library.md)、[Library · 指标与维度](../../../../feature/reports/library/metrics.md)。

| 契约 | 场景 |
|---|---|
| MetricCell 携带 value/display/samples/total/refs；缺数据格子 value 为 null 且不渲染成 0 | 三格 fixture：measuredZero、partial、missing 互不混淆 |
| 覆盖率与 refs 不因渲染或 JSON 序列化丢失 | 正例：serialize round-trip 后 refs 完整 |
| 组件消费 `data` 时校验结构：不符合当前版本形状按完整用户反馈报错并提示可能的版本漂移，不静默错渲染 | 反例：字段改名前的旧 JSON 传入 data 形态报错且文案含版本漂移提示；正例：round-trip 的同版本 JSON 照常渲染 |
| `validate*Data` 递归覆盖到嵌套字段，不只检查顶层哨兵：数组每一项逐项校验（而非只看数组本身是否存在）、嵌套 `MetricCell` / 四态 tally 按字段级校验、判别联合按 `kind` 分支各自校验必填字段；报错文案带完整字段路径定位到具体坏字段，不是笼统的整份 data 报错；结构错误恒转成 `dataShapeError` 完整用户反馈，不让 renderer 抛未处理的 `TypeError` | 正例：`TableData.rows[0].cells.<metric>` 缺 `samples` 报错路径含 `rows[0].cells.<metric>.samples`；正例：`MatrixData.cells[i].cell`、`ScatterData.rows[i].y`、`DeltaData.rows[i].cells.<metric>.a` 结构错误各自定位到该嵌套格；正例：`ScoreboardData.rows[i].subjects[j]` 缺 `possible` 报错路径含该 subject 下标；正例：`ExperimentListItem[i].endToEndPassRate` / `EvalListItem[i].examScore` / `AttemptListItem[i].costUSD` 类型错误（如误传字符串）各自报错；正例：`ScopeWarning` 按 `kind` 分支校验：`partial-coverage` 缺 `covered` 与 `stale-snapshot` 缺 `latestStartedAt` 报出对应分支缺的字段，不是通用的「缺字段」；正例：`AttemptConversationData.rounds[i].replies[j]` 按 `kind` 分支校验，`tool` 分支缺 `callId`、`input` 分支缺 `request` 各自报错；边界：数组为空（`rows: []`）本身合法，不报错；边界：可选字段（如 `MetricColumn.unit`、`ScopeWarning` 的 `command`）缺省不报错 |
| 缺 artifact 时指标返回 null，渲染层不猜值；`assistantTurns` / `repeatedFailedCommands` 缺 `o11y.json` 显示缺失不冒充 0 | 正例：删 o11y.json 后两指标为 missing；反例：来自 result.json 的指标不受影响 |
| `repeatedFailedCommands` 口径：同一 attempt 内每条命令失败 n 次（n>1）记 n−1 求和；成功执行与只失败一次的命令不计 | 正例：同命令失败 3 次记 2；反例：两条不同命令各失败 1 次记 0 |
| value 与 display 分别可断言；display 由 unit 或自定义 display(value) 驱动 | 正例：value≈5/6 与 display="83.3%" 独立断言 |

## 数据计算函数（`*Data`）行为

契约来源：[Library · 概览组件](../../../../feature/reports/library/summaries.md)、[Library · 实体列表](../../../../feature/reports/library/entity-lists.md)、[Library · 指标组件](../../../../feature/reports/library/metric-views.md)、[Show](../../../../feature/reports/show.md)。

| 契约 | 场景 |
|---|---|
| `experimentListData()` 对完整 input 计算 experiment 列表，每个 experiment 的 eval 集以快照 `selectedEvalIds` 为准；不同深度目录（如 `compare/a`、`bench/long/x`、`standalone`）的 experiments 一律进同一份 data，不再按父路径分组比较；`ExperimentComparison` 把同一个 `input`（缺省 `ctx.scope`）原样透传给 `ScopeSummary` / `MetricScatter` / `ExperimentList`，组合本身不二次计算或过滤，也不导出自己的 `data` 形态 | 正例：两个 experiment 选择不同 eval 集，列表 eval 数与各自分母如实且未选择项不补失败；正例：三种深度不同的 experiment id 混在一份 input 里，直接调用 `experimentListData` 与经 `ExperimentComparison` resolve 展开后 `ExperimentList` 收到的 spec 深等；正例：来源快照缺 `selectedEvalIds`（第三方）时该 experiment 按其实际 evals 可见；正例：resolve 后 `ExperimentComparison` 展开树里 `ScopeSummary`/`MetricScatter`/`ExperimentList` 三个组件收到的 spec `input` 与 `ctx.scope` 同引用 |
| `ExperimentComparison` 展开树里 `ExperimentList` 的行标签缩短是 `ExperimentList` 自己的契约，`ExperimentComparison` 不二次处理；与 `MetricScatter` 点标签共用同一份最短唯一后缀算法（`shortestUniqueLabels`），同一份 id 集合两个组件得到相同显示名 | 正例：`compare/a`、`dev/b` 经 `ExperimentComparison` 展开后 `ExperimentList` 显示 `a`、`b`，`MetricScatter` 点标签同样显示 `a`、`b` |
| `MetricScatter` 对缺 x 或 y 的点不绘制并报告缺失数；零点显示明确空态；单点照常绘制 | 边界：0 点 / 1 点 / 部分缺 x；反例：单点不被拒绝 |
| 散点轴方向跟随指标 `better`：lower 反向（左贵右便宜）、higher 正向，「更好」恒指向右上，提示恒为「越靠右上越好」；刻度显示真实值；未声明 better 的轴正向且整图不出方向提示；两面同规则 | 正例：成本 × 通过率图上低成本点落在右侧且刻度值仍从大到小；边界：x 无 better 时无方向提示；正例：text 面同方向 |
| `MetricLine` 对未声明数值 flag 的 experiment 不伪造 x 值并报告未绘制数 | 正例：flag 缺失与 flag="high" 两种；反例：不落到 x=0 |
| `DeltaTable` 任一侧缺数据时 delta 保持缺失；方向按指标 `better` 判断改善/退化 | 正例：better:"lower" 的 costUSD 下降判改善；边界：一侧缺时 delta 为 null |
| `pairsByFlag` 在 input Scope 内按「删除该 flag 后可比性配置深相等」配对：a 取 baseline，b 侧每个其它取值各成一对；配对边界只是 input Scope，不额外按 experiment id 的目录前缀分组 | 正例：三 agent × baseline/agents-md/mempal 矩阵导出 5 对；反例：model 不同的两实验不配对；边界：单实验时 0 对显示空态；正例：`compare/codex` 与 `bench/codex` 两个不同目录前缀的实验，只要删除该 flag 后可比性配置深相等就配对成一对（不因目录前缀不同而拆开） |
| `pairsByFlag` 派生的 `DeltaPair.label` 使用完整 a experiment id（不截断成末段）；派生 pair 的排序仍按 a 的末段、再按 flag 显示键 | 正例：`a: "compare/codex"` 派生的 label 以完整 `"compare/codex"` 开头，不是 `"codex"`；正例：a 末段相同但完整 id 不同的两组 pair（如 `groupX/codex` 与 `groupY/codex`）排序只看末段与 flag 显示键，不因完整 id 的字符串差异打乱顺序 |
| `pairs` 与 `questions` 类型放宽为普通数组，空数组在计算时按完整用户反馈报错；`metrics` / `columns` 保留非空元组 | 反例：`.filter()` 后为空的 pairs 报错且文案完整；正例：运行期构造的非空 pairs 直接可用，无需元组断言 |
| `FailureList` 与手写组合等价：verdict ∈ failed/errored、开始时间降序（同刻按 locator 字典序）、`limit` 截断（默认 20）且 total 报告截断前总数 | 正例：与 `attemptListData` 手工过滤排序的渲染结果深等；边界：失败数少于 limit 时 total 等于 data 长度 |
| `MetricMatrix` 是稀疏矩阵：无 attempt 的行列组合不生成格子；`MetricBars` 消费同一份矩阵数据 | 正例：缺组合无格子（而非 value:0）；正例：Bars 与 Matrix data 同源 |
| `AttemptListItem` 只携带算好的单行摘要：`failureSummary`（failed 取主失败断言摘要、errored 取 error 一层摘要、passed/skipped 为 null）与 `moreFailures` 计数；序列化 JSON 不含 assertions、stack、evidence 或 diagnostics | 正例：failed/errored/passed 三态的 failureSummary 各自正确；反例：多失败 attempt 的 JSON.stringify 结果不含第二条断言文本与 stack |
| `ScopeSummaryData` 恒携带 eval 级与 attempt 级两份计票，`evals` 按 `experimentId + evalId` 计数、与 `evalVerdicts` 同分母；呈现 prop `votes` 只选择显示哪一级（默认 eval），不改变 data；web 面 KPI 使用双语短标签、不暴露原始 ISO 时间，成本覆盖不全时给出带语义的覆盖说明 | 正例：2 实验 × 6 Eval 的 fixture 下 evals=12 且计票总和一致、两级计票在含重试时不同；边界：`votes="attempt"` 切换显示但 data 深等；正例：成本 8/9 有数据时显示 `Cost available for 8/9 attempts / 8/9 次有成本数据`，而不是裸 `8/9` |
| `experimentListData` 对同一 experiment 的输入含不一致可比性配置时按完整用户反馈失败，指引 snapshot 维度 / MetricLine；宿主注入的 `current()` Scope 天然满足单义 | 反例：手工拼两份 model 不同的快照数组报错且文案含下一步；正例：current() Scope 照常计算 |
| `DeltaData.rows` 携带作者声明的 pair `label` 原样透传，renderer 据此显示行名 | 正例：LocalizedText label 经 data round-trip 后两面显示一致 |
| `MetricLine` 点身份为 `(series, x)`：同桶多 experiment 按 (series, x, experiment, eval) 顺序聚合成一个点；自定义 `NumericAxis.of` 在同一 experiment × eval 内返回不同值时计算以完整用户反馈失败 | 正例：两 experiment 同 x 合成一点且 y 为跨题聚合；反例：逐 attempt 变化的 of 报错不静默取首值 |
| 分组维度上未声明的 flag 归 `(missing)` 组（metrics.md 的内置文案），不丢行 | 正例：部分 experiment 无该 flag 时 (missing) 计数正确 |
| `MetricTable` 的 `sort` 决定初始行序，方向由指标 `better` 决定（好在前） | 正例：sort=endToEndPassRate 高在前、sort=costUSD 低在前 |

## 站点组件与内建报告

契约来源：[Library · 站点组件](../../../../feature/reports/library/site-components.md)、[Library · 内建报告](../../../../feature/reports/library/built-in.md)、[Library · 实体列表](../../../../feature/reports/library/entity-lists.md)、[Results Library · 警告 kind 全集](../../../../feature/results/library.md#警告-kind-全集)。

| 契约 | 场景 |
|---|---|
| 内建报告 `standard` 是四张 page（`report` / `attempts` / `traces` / `attempt`），其中三张进导航、第四张是 `navigation: false` 的参数化 attempt-input page，页内容全部由公开组件组成，与 `--report` 同内容文件完全等价 | 正例：裸宿主装载的 definition 与内建入口默认导出同引用；正例：内建定义四张 page 的 id、标题、`input`/`navigation` 与逐页组件构成和 built-in.md 全文一致；正例：`standard.pages` 第四项与具名导出 `standardAttemptPage` 同引用 |
| 内建入口是视图集合：每个内建视图按名字具名导出（当前只有 `standard`），默认导出恒等于 `standard` | 正例：默认导出与 `standard` 同引用 |
| `defineReport({ extends: base, … })` 在整份报告上叠外壳：页列表取 base 的页列表（同引用）；外壳字段声明即整字段覆盖、未声明沿用 base；产物是普通 `ReportDefinition`，可再被 extends | 正例：无外壳字段的 `defineReport({ extends: standard })` 逐页两面渲染与内建逐字节相同；正例：`defineReport({ extends: standard, title, links })` 页列表与 `standard` 逐项同引用、`ctx.report.title` 取自定义 `title` 且 links 生效；正例：二级 extends 链的页列表仍与 `standard` 逐项同引用且外壳按最近声明取值（声明整字段覆盖、未声明沿用） |
| `Hero` 组合组件缺省取 `ctx.report.title`（回退链后的站点标题），显式 `title` prop 覆盖；与手写 `<HeroCard title={…} data={await heroData(ctx.scope)} />` 严格等价 | 正例：声明 `title` 后 `<Hero />` 两面输出含该标题且与浏览器标题同源；正例：显式 `title` prop 覆盖声明；正例：与手写组合渲染深等 |
| `heroData`：`latestStartedAt` 取范围内最新快照开始时间（空范围为 null，不编造当前时间）、`snapshots` 计贡献快照数；`HeroCard` 在 snapshots > 1 时 web 面标注合成来源 | 正例：多快照 fixture 标注「由 N 次运行合成」；边界：空 Scope 显示「暂无运行」且 `latestStartedAt` 为 null |
| `CopyFixPrompt`：prompt 在 resolve 阶段算好并烘进静态 HTML，无 JS 时折叠块内完整可读，复制是增强层行为；`failures` 为 0 时两面零输出；text 面恒零输出 | 正例：两失败 fixture 的 prompt 含 eval id、主失败摘要与 attempt 下钻命令；边界：全 passed 时无任何节点；反例：show 输出不含 prompt 文本 |
| `TraceWaterfall`：web 面每 attempt 一行静态渲染顶层 span 分解条（失败 span 带失败标记），行链接 attempt 详情；text 面每 attempt 一行含 locator、总耗时、span 计数与可复制的 `--timing` 下钻命令；trace 缺失的 attempt 行照常出现并如实显示缺失 | 正例：两 attempt（一含失败 span）两面各自正确且 spans 按 startOffsetMs 升序；边界：缺 trace.json 的 attempt 的 `durationMs` 为 null 且行不消失；反例：runner 生命周期节点不进瀑布行 |
| `AttemptList` 的 `filter` 是 web 面渐进增强过滤框，不改变数据、行集合与 text 面输出 | 正例：有无 `filter` 时初始行集合与 text 输出相同 |
| `unreadable-snapshot`：扫描结果根遇到 schema 不兼容 / malformed / incomplete 快照时形成 Scope warning（`dir`、`reason`），schema 不兼容带 `npx niceeval@<producer.version>` 的 `command`；非实验作用域，`scope.filter` 修剪时保留；非 niceeval JSON 静默忽略不触发 | 正例：malformed 快照产生 warning 且其余快照照常计入；正例：incompatible 的 warning 带版本化 command；边界：`filter` 收窄后该 warning 仍在；反例：目录里的无关 JSON 不产生 warning |

## 组件解析（resolve）与组合组件

契约来源：[Architecture](../../../../feature/reports/architecture.md)「组件模型」「报告树与两个宿主」、[Library · 排版原语与自定义组件](../../../../feature/reports/library/layout.md)、[Library · 指标组件](../../../../feature/reports/library/metric-views.md)、[Library · 外壳与多页](../../../../feature/reports/library/shell.md)。

| 契约 | 场景 |
|---|---|
| spec 形态与「先手工调 `*Data` 再传 `data`」严格等价：同一 spec 经管线 resolve 与手工计算渲染出相同终值、覆盖率与 refs | 正例：`MetricScatter` spec 形态与 data 形态两棵树渲染深等；反例：同一组件同时给 `data` 与 spec 字段报完整用户反馈 |
| spec 形态 `input` 省略时取宿主注入的 Scope，显式 `input` 覆盖数据来源 | 正例：`ScopeSummary input={scope.filter(...)}` 只统计收窄后快照；正例：`MetricTable input={exp.snapshots}` 按快照出行 |
| resolve 记忆化：一次页渲染内同引用 `input` + 深相等 spec 只计算一次；深相等中函数与 Metric / Dimension / NumericAxis 实例按引用比较 | 正例：Matrix 与 Bars 同 spec 时计算函数只被调一次；反例：不同 spec 或不同 `input` 各自计算；边界：两个字段相同但实例不同的 Metric 各自计算、不报错 |
| `ReportNode` 全集：元素、数组 / Fragment（展平保序）、null / undefined / boolean（渲染为空）；裸字符串与数字在树校验时按完整用户反馈拒绝并指引包 `Text` | 正例：`groups.map(...)` 数组与 `cond && <X />` 两面渲染正确；反例：树中放裸字符串报错文案含 Text 指引 |
| 组合组件在 resolve 阶段以 `(props, ctx)` 调用并递归展开返回树；`ctx` 携带 `scope`、`results`、规范化声明 `report`（`pages` 逐项含 `id`/`title`/`input`/`navigation`）与当前页判别 `page`；async 组合可用 | 正例：组合组件树与手写等价树渲染相同；正例：`ctx.results` 取历史快照喂 `input`；正例：`ctx.report.title` 是走完回退链的标题、`ctx.report.pages` 逐项含 `input`/`navigation`；正例：scope-input page 内组合组件收到 `ctx.page` 为 `{ id, input: "scope" }`；正例：attempt-input page 内 `ctx.page` 为 `{ id, input: "attempt", locator, evidence }`，`evidence` 与宿主装配的 `AttemptEvidence` 同引用 |
| 同层 sibling 并行取数与展开，输出保持声明顺序 | 正例：慢 resolve 在前、快 resolve 在后时输出顺序不变 |
| 非法节点在展开遇到时以完整用户反馈拒绝且不为其取数：React 组件、未经 `defineComponent` 的普通函数、任意 HTML intrinsic | 反例：树中放裸函数组件报错文案完整；反例：`<div>` 同样拒绝 |
| `defineComponent` 两种形态：函数形态产出组合组件；对象形态缺 `text` 或 `web` 在定义时报错（TS 编译期 + 无类型 JS 运行期） | 正例：函数形态产物可入树；反例：只给 `web` 的对象形态定义时报完整用户反馈 |

## MetricScatter 点标签布局（web 面）

契约来源：[Library · 指标组件](../../../../feature/reports/library/metric-views.md)「MetricScatter」。布局是 `chart-math` 的纯几何函数，场景直接对函数断言标签框与点框的几何关系，不经 HTML。

| 契约 | 场景 |
|---|---|
| 标签从点四周候选位择优：存在无冲突候选时，标签不与其它标签重叠、不遮盖任何数据点、不越出画布；全候选冲突时取重叠最小者，不丢标签 | 正例：三点近重合 + 正下方另一点的簇，标签框两两不叠且不压任何点框；反例：只向下推的级联布局会把第三个标签推到下方点上，可区分 |
| 无冲突时标签取点右侧紧邻位且不带 leader 标记；离开左右紧邻位的标签带 leader 标记；靠画布右缘的点标签整体落在画布内 | 正例：稀疏两点右侧紧邻、无 leader；边界：右缘点锚到左侧紧邻位、标签框不越出画布、无 leader 标记 |

## labels 维度与 series 归类

契约来源：[Library · 指标与维度](../../../../feature/reports/library/metrics.md)「维度与数值轴」、[Library · 概览组件](../../../../feature/reports/library/summaries.md)「ExperimentComparison」、[Experiments Library](../../../../feature/experiments/library.md)「labels」。

| 契约 | 场景 |
|---|---|
| `label()` 读快照 `ExperimentRunInfo.labels` 的声明值作分组维度，报告不从 experiment id 字符串猜；`numericLabel()` 只接受 number 值 | 正例：`label("line")` 按声明值分组；边界：未声明该键的实验归 `(missing)`；反例：`numericLabel` 对字符串值返回 null，不猜序 |
| series 类选项接受非空数组解析为复合维度：name 依声明顺序以 ` × ` 连接，值以 ` · ` 连接，缺失成员沿用 `(missing)` 参与连接 | 正例：`["agent", label("memory")]` 的 seriesDimension 与行 series 值；边界：单成员数组等价于单维度 |
| `ExperimentComparison` series 缺省解析：Scope 内任一实验声明 label `line` → `label("line")` 并连线，否则 `"agent"` 不连线；显式 series 覆盖缺省 | 正例：声明 line 时为 "line"；无 line 时回落 "agent" |

## show/view 宿主装载等价

契约来源：[README](../../../../feature/reports/README.md)、[Architecture](../../../../feature/reports/architecture.md)、[Show](../../../../feature/reports/show.md)、[View](../../../../feature/reports/view.md)。宿主等价在装载边界记录 definition 与 Scope，不比较终端输出与 HTML——渲染面与进程级读面行为归 [E2E 功能域 · 报告与读面](../../e2e/report.md)。

| 契约 | 场景 |
|---|---|
| 裸 `show` 与裸 `view` 把同一 Scope 交给同一份内建报告定义（`niceeval/report/built-in` 默认导出）；`--report` 替换同一报告槽 | 正例：装载边界捕获两宿主的 definition 同引用、scope 深等 |
| 两宿主对 `--results` / `--exp` / 位置参数用同一套选择规则；局部补跑/过旧/未完成快照形成结构化 warning 随 Scope 携带 | 正例：未完成快照在两宿主产出相同 warning 集 |

```ts
import builtInReport from "../../report/built-in/index.tsx"

it("show 与 view 的默认报告槽消费同一 Scope", async () => {
  const results = resultsFixtureWithPartialRerun()
  const show = await captureShowReportInput(results)
  const view = await captureViewReportInput(results)

  expect(show.definition).toBe(builtInReport)
  expect(view.definition).toBe(builtInReport)
  expect(show.scope).toEqual(view.scope)
})
```

## Attempt 参数化 page 与详情组件族

契约来源：[Library · Attempt 详情组件](../../../../feature/reports/library/attempt-detail.md)、[Architecture](../../../../feature/reports/architecture.md)「Attempt 详情是一张参数化 page」。台账：[view-attempt-detail-buries-failure](../../../../../memory/view-attempt-detail-buries-failure.md)（断言区缺失、timing 树压顶如何逃逸到真实使用）、[attempt-detail-is-a-parametrized-page](../../../../../memory/attempt-detail-is-a-parametrized-page.md)（详情从宿主路由内容翻案为参数化 page 的裁决）。

| 契约 | 场景 |
|---|---|
| `AttemptEvidence` 由 `loadAttemptEvidence` 一次装配；11 个叶子的 `attempt*Data(evidence)` 只做同步/纯派生，不读文件、不 fetch、不重复调用 `attempt.events()` / `attempt.trace()` / `attempt.diff()` | 正例：spy 底层 IO 方法后 resolve 一张 attempt page 只触发一次装配；正例：对同一份 fixture evidence 依次调用全部 11 个 `attempt*Data`，互不触发额外 IO |
| `AttemptAssessment` 只表达 `AttemptError` + `AttemptSource`/`AttemptAssertions` 二选一：`evidence.capabilities.source` 为真时放 `AttemptSource`，否则放 `AttemptAssertions`；不在 attempt-input page 之外调用时报错 | 正例：有 source 的失败 attempt 展开树含 `AttemptSource` 不含 `AttemptAssertions`；正例：无 source 时相反；反例：`ctx.page.input !== "attempt"` 时 resolve 报完整用户反馈 |
| `AttemptDetail` 按内建顺序装配详情；有 source 时 `AttemptSource` 已承载按 loc 展开的回复，不再重复独立 `AttemptConversation`，无 source 时才在 usage 后放 `AttemptConversation` fallback | 正例：有 source 的一级子节点序列不含 `AttemptConversation`；反例：无 source 时序列含 `AttemptConversation` 且仍在 `AttemptUsage` 与 `AttemptTrace` 之间 |
| `attemptSourceData` 把标准事件流按 `loc` 投影回 send 行：send 行的 `turns` 携带该轮 `sentText` 与按序归并的完整回复，源码行因此能在行内展开该轮对话。web 面的染色、布局与展开交互（[视觉规范](../../../../feature/reports/library/attempt-detail.md#attemptsource-web-面视觉规范)）不在单元层验收，归 [E2E 功能域](../../e2e/report.md) | 正例：send（带 loc）+ assistant 回复的事件流，对应源码行 `turns[0]` 含 `sentText` 与完整回复条目。bug: [attempt-detail-components-shipped-without-styles](../../../../../memory/attempt-detail-components-shipped-without-styles.md) |
| 叶子组件的 spec 形态省略 `input` 时取当前 attempt-input page 注入的 evidence；显式 `data` 与手工 `attempt*Data(evidence)` 结果深等；放在 scope-input page 且未显式传 `input`/`data` 时 resolve 报完整用户反馈并指引移到 attempt-input page 或传入 evidence | 正例：`<AttemptSummary />` 在 attempt page 内的 spec 结果与手工 `attemptSummaryData(evidence)` 深等；反例：`<AttemptSummary />` 放进 scope-input page 报错文案含"移到 attempt-input page"或"传入 evidence" |
| `AttemptConversation` 数据来自 `AttemptEvidence.events`（标准事件流），按 `loc` 分轮：无 `loc` 的 user 消息不开新轮（同文本回显吃掉、轮内注入按 `kind:"user"` 留在当前轮）；事件按条目容错，未识别类型包成 `view.raw` 原样呈现且不吞没其余事件；`skill.loaded` 是一等回复条目 | 正例：send（带 loc）后紧跟同文本无 loc 回显，回复仍全部聚到 send 行；正例：混入完全未知的事件类型时该条目原始 JSON 保留、其余事件照常聚合；正例：`skill.loaded` 显示 Skill 名不伪装成工具调用；边界：流首无 loc 的 user 消息（旧 artifact）仍开 noloc 轮 |

## 外壳与页面的装载语义

契约来源：[Library · 外壳与多页](../../../../feature/reports/library/shell.md)、[Library · 内建报告](../../../../feature/reports/library/built-in.md)、[Architecture](../../../../feature/reports/architecture.md)「外壳与页：装载规范化」、[Show](../../../../feature/reports/show.md)、[View](../../../../feature/reports/view.md)。

| 契约 | 场景 |
|---|---|
| `--report` 文件默认导出恒为 `defineReport` 产物；装载规范化唯一产物是「外壳 + 非空页列表」：`defineReport(树)` ≡ `{ content: 树 }` ≡ `pages: [{ id: "report", title: 内置页名, content: 树 }]`，任何形态走同一条装载管线；非 `defineReport` 产物的默认导出报完整用户反馈 | 正例：三种写法装载出等价的规范化结果（唯一页 id 为 `report`）；反例：默认导出普通对象或 React 组件时报完整用户反馈 |
| `content` / `pages` / `extends` 恰好声明一个：多选或都省略装载报错，报错文案给出下一步——要内建报告写 `extends: standard`（`import { standard } from "niceeval/report/built-in"`） | 反例：`content` 与 `pages` 同时声明报完整用户反馈；反例：`extends` 与 `pages` 同时声明报完整用户反馈；反例：都省略报错且文案含 `niceeval/report/built-in`；正例：`defineReport({ title, links, content: <ExperimentComparison /> })` 渲染内建首页内容并带自定义外壳 |
| `extends` 只收 `defineReport` 产物：普通对象、React 组件或报告树装载报错（TS 编译期拒绝，无类型 JS 输入装载期同样校验） | 反例：`extends: {}` 与 `extends: <ExperimentComparison />` 各报完整用户反馈 |
| 页不嵌套外壳：`content` / `page.content` 只接受报告树节点，`defineReport` 产物放进任何 content 或树中装载报错（TS 编译期拒绝，无类型 JS 输入装载期同样校验） | 正例：具名导出的树与组合组件节点都可直接作 `page.content`；反例：页里放 `defineReport` 产物装载报错 |
| 裸 `show` / 裸 `view` 装载 `niceeval/report/built-in` 的默认导出，与 `--report` 同一条 `装载 → resolve → validate → render` 管线 | 正例：裸宿主装载的 definition 与该默认导出同引用 |
| 全部页共享宿主注入的同一 Scope，位置参数与 `--exp` 收窄对全部页生效；页不承担数据过滤 | 正例：两页的解析 refs 来自同一收窄后 Scope |
| 标题取值链 def.title → Scope 中唯一且相同（LocalizedText 深相等）的快照 name → 内置文案「Eval 运行结果 / Eval Results」，落点是浏览器标题、show 页索引标题行与 `ctx.report.title` | 正例：三级 fallback 各一 fixture，`ctx.report.title` 与浏览器标题同源；边界：两快照 name 的 en 相同、zh-CN 不同时任何 locale 下都落内置文案 |
| `{src}` 资产相对报告文件解析，拒绝 `..` 路径段、绝对路径与 `~`；静态导出复制进 `assets/` 保持相对路径，缺失文件报错并给出解析后路径 | 正例：`./assets/a.js` 被复制；反例：`../x.js` 装载报错；边界：缺失文件在导出时报错 |
| `head` 标签白名单是 `meta` / `link` / `script` / `style`，白名单外与宿主自有单例（`title` 不在白名单、`meta charset`、`meta name="viewport"`）装载报错并指回对应契约 | 反例：`{ tag: "base" }` 装载报错；反例：`meta charset` / `meta viewport` 装载报错且文案指回 title 契约或宿主职责 |
| `head` 的 `attrs` 值为 `true` 渲染裸布尔属性，字符串渲染 `key="value"` 且值 HTML 转义；`script` / `style` 的 `children` 原样落进标签，内容含 `</script>` / `</style>` 时装载报错 | 正例：`{ async: true, src: 外链, "data-project": "a\"b" }` 渲染 `async` 裸属性且引号转义；反例：children 含 `</script>` 装载报错 |
| `head` 的 `src` / `href` 按 scheme 分流：`http(s)://` 外链原样落标签、不进 `assets/`；本地相对路径走 `{src}` 同一路径纪律并物化为 `assets/<sha256><ext>`；protocol-relative `//` 与其它 scheme 装载报错 | 正例：GA4 外链 src 原样出现在 HTML 且 `assets/` 不含它；正例：`./favicon.svg` 改写为 `assets/<sha256>.svg` 且站点清单含该文件；反例：`//cdn.example/x.js` 装载报错 |
| `head` 不进 `ctx.report`（与 `scripts` / `styles` 同为注入资产）；show 不消费 `head` | 正例：声明 head 后组合组件 `ctx.report` 无该字段；反例：show 输出不含 head 标签内容 |
| `scripts` / `styles` 的 `{src}` 只收本地路径，外链装载报错并指引改写成 `head` 条目 | 反例：`{ src: "https://cdn.example/x.js" }` 装载报错且文案含 `head` 写法 |
| 重复或非法 page id 在装载时校验失败，报错列出冲突 id | 反例：两页同 id `exam`；反例：id 含大写或斜杠 |
| page 省略 `input` 时规范化为 `input: "scope"`、`navigation: true`；声明 `input: "attempt"` 的 page 必须显式 `navigation: false`，省略或传 `true` 时装载报错 | 正例：省略 input 的 page 规范化后 `input === "scope"` 且 `navigation === true`；反例：`{ input: "attempt" }` 不带 `navigation: false` 装载报错；反例：`{ input: "attempt", navigation: true }` 装载报错 |
| 一份 definition 最多声明一张 `input: "attempt"` 的 page，第二张同类 page 装载报错并指出冲突 page id | 反例：两张 `input: "attempt"` 的 page 装载报错 |
| 没有 locator 时不能用 `--page` / `#/page/<id>` 打开 attempt-input page；有 locator 时才注入对应 `AttemptEvidence` 并 resolve | 反例：`--page attempt`（无 locator）报用户错误，不拿 Scope 强行 resolve；正例：带 locator 时该 page 正常 resolve |

## o11y 数据派生

契约来源：[Observability](../../../../observability.md)「OTLP traces → 统一瀑布图」、[Concepts](../../../../concepts.md)「执行树」。归一之后、与具体协议无关的确定性派生，喂给 `--execution` / `--timing` 与成本指标。

| 契约 | 场景 |
|---|---|
| `estimateCost` 按 model key 查价计算成本：精确 key 覆盖内置价格表、未知 model 返回 null 不猜、usage 缺口按声明口径处理 | 正例：覆盖价目表后按覆盖价计算；边界：未知 model 为 null；反例：不把缺 usage 记成 0 成本 |
| `buildExecutionTree` 把标准事件流与 OTel span 合成执行树：无 OTel 时骨架完整、span 按 callId 精确合并、关联不上降级 telemetry-only 节点不猜、同 callId 撞多条不强行择一、乱序/截断 transcript 生成占位节点、`skill.loaded` 一等节点、tool 失败状态透传 | 表驱动：上述每种输入形态各一 fixture，断言树结构与节点归属 |

## 不这样测

- 不把 Reports 整体当作"展示层"薄测；选择、去重、指标和聚合会静默给错答案。
- 不在本层断言渲染产物——终端排版、DOM 结构与快照锁定的是呈现，归 [E2E 功能域 · 报告与读面](../../e2e/report.md)对真实产物验收；本层观察数据。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 数值、排序、覆盖率和 refs 直接精确断言，不从渲染字符串反推。
