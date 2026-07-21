# TODO：Reports `Grid` / `Stat` / `Section.meta` 一步到位实现

> 给实现 Agent：直接让当前代码完整满足 [`docs/feature/reports/library/layout.md`](../docs/feature/reports/library/layout.md#grid-与-stat) 已定稿契约；同一份报告在 `niceeval view` 与 `niceeval show` 中分别得到文档声明的 web / text 输出。直接在 `main` 工作，不建分支，不拆阶段，不以“核心已实现”提前结束。

## 完成态

- `niceeval/report` 公开导出 `Grid`、`Stat`、`GridProps`、`StatProps`，`SectionProps` 包含 `meta?: LocalizedText`。
- 目标文档中的完整“运行总览”示例可直接编译运行；`view` 呈现响应式 6 列主区 + 9 列 compact 区，`show` 按显示宽度减列且不丢 21 个 Stat。
- `Grid` / `Stat` 是纯排版原语：不读取 Scope、不增加数据 schema 或 `*Data`、不吞掉 `MetricCell.samples / total / refs`。
- show / view 不新增宿主特例；实现只落共享 report runtime、官方 report stylesheet、公开导出和既有双宿主 fixture。
- 测试登记、实现测试、公开中文文档、预编译 `dist/report` 与 Source Map 同步，全量验证通过。

## 权威契约

- [Library · `Grid` 与 `Stat`](../docs/feature/reports/library/layout.md#grid-与-stat)
- [Architecture · 报告树与两个宿主](../docs/feature/reports/architecture.md#报告树与两个宿主)
- [Architecture · 排版原语的语义层与面内布局](../docs/feature/reports/architecture.md#排版原语的语义层与面内布局)
- [Architecture · 静态网页](../docs/feature/reports/architecture.md#静态网页)
- [Reports 测试架构](../docs/engineering/testing/unit/reports.md)
- [Reports 用例登记表](../docs/engineering/testing/unit/reports.md)
- [Source Map · Reports](../docs/source-map.md)

## 本次审计确认的 docs ↔ code gap

| 层 | 当前事实 | 必须收口 |
|---|---|---|
| 原语与公开 API | [`src/report/definition/primitives.tsx`](../src/report/definition/primitives.tsx) 和 [`src/report/index.ts`](../src/report/index.ts) 仍只有八个原语；Section 无 meta | 新增 Grid / Stat 双面原语，Section 增 meta，公开值与 props 类型并改成十个原语 |
| 树节点处理 | tree runtime 能处理数组 / Fragment / 空分支，但 primitives 只有浅层 `childArray` 与 Tabs 私有展平 | Grid 的直接 child 必须按 `ReportNode` 规则递归展平；一个展开后的节点才是一格，Col 保持一格内分组 |
| text 面 | Row 只有“全部并排或全部纵排”，没有可规划的多行网格 | 按 Architecture 新增纯 `TextGridPlan`：从 `columns` 向下选择可读列数，row-major、不丢格；boxed / plain、regular / compact 和单列 fallback 满足文档 |
| web 面 | report stylesheet 没有 Grid / Stat / Section meta 结构与样式 | 增稳定 `nre-*` 结构、CSS Grid、响应式减列、完整 cell 四边框、density、tone 和 Section header/meta |
| 契约句子 | `GridProps.columns` 是普通 `number`，但目标文档写“TypeScript 接受不到非正整数” | 改成“运行时拒绝非有限正整数和小数”；类型仍是 `number`，两面共享校验 |
| 测试登记 | [`cases.md`](../docs/engineering/testing/unit/reports.md) 没有 Grid / Stat / Section.meta 场景 | 先登记对应场景，再写实现测试；不新增未登记测试 |
| 双宿主公开消费 | show / view 已共用 report runtime，但 fixture 未使用新 API | 扩充既有 `exam-report.tsx` 与 `view-report.test.ts`，证明一个公开报告文件被两个宿主消费 |
| 公开用户文档 | 中文参考仍写六个原语；教程仍把所有非表格形态导向 `defineComponent` | 同步成十个原语，加入自由摘要格任务和短示例 |
| Table 契约冲突（非 theme gap） | 公开 `TableColumn` 类型、text renderer 与 cases 已支持 `maxLines`，但 Feature 的穷尽形状和 props 表未列该字段 | 保留既有实现与登记场景，在 `layout.md` 的 `TableColumn` 形状、字段表和渲染契约补齐 `maxLines?: number`；不得让公开类型继续超出 Feature 形状 |
| Source Map | 当前文档已把 Grid / Stat 映射到 `primitives.tsx`，代码尚不存在 | 实现落在该位置；若拆 helper，更新 Source Map 到真实物理位置 |
| 共用宿主边界（非 theme） | `src/view/{data,site}.ts` 反向 import `src/show/report-host.ts`，而 Architecture 明确禁止 show / view 互相 import | 把报告装载、meta、本地化与逐页双面适配下沉 `src/report/runtime/host.ts`；show 只保留终端命令拼装，两个宿主分别依赖 report runtime |
| `pairsByFlag`（非 theme） | 目标契约以 input Scope 为配对边界并用完整 a experiment id 自动命名；代码仍把 `experimentGroupOf(id)` 混入 bucket，label 只用末段 | bucket 只按删除 flag 后的可比性配置；label 改完整 a id，排序仍按 a 末段 + flag 显示键；先补登记与回归测试 |
| data 形态校验（非 theme） | 多数组件 validator 只看少数哨兵字段，嵌套必填字段错误可穿过 validate 后在 renderer 中错渲染或异常 | 按公开 `*Data` shape 做完整递归结构校验，错误指出组件、字段路径、期望与版本漂移提示；用表驱动字段突变覆盖，不复制计算逻辑 |
| Source Map 现状项（非 theme） | view attempt 深链映射到不存在的 `src/view/app/lib/attempt-route.ts`，view 行仍写宿主不渲染品牌；当前实现与目标文档已不是该事实 | 指向真实 route helper / App 位置，并按最终固定 host brand 契约改描述；不得为迁就 Source Map 新造空文件 |

## 明确排除

- 不实现或审计 `ReportTheme`、`defineTheme`、外壳 `theme`、整站 token 迁移、view chrome 主题注入及 theme 文档的其它缺口。
- 当前工作树中的 `docs/feature/reports/library/theme.md` 及相关并行改动属于用户或其它 Agent；不覆盖、不回退、不顺手提交。
- Grid / Stat 新样式只使用执行时 report stylesheet 已有的中性 / 状态变量并保留零配置默认观感；如果并行 theme 实现已经改名变量，只适配本组件调用点，不承担主题系统建设。
- 不新增 `MetricStats`、通用 List、breakpoint/minWidth、rowSpan/columnSpan、renderItem、数据 schema、`*Data` 或结果格式字段。
- 不把 Grid / Stat 导出到 `niceeval/report/react`；当前目标只要求 `niceeval/report` 报告树双面原语，不能自行扩大 React 子入口。
- 不改 `enhance.js`，不在 show / view 加 Grid 专用分支，不为 text 面新造 ANSI 颜色协议。

## 一次性 TODO

- [ ] 执行前记录 `git status --short`、未暂存 diff 与暂存 diff；未知和并行改动全部保留，只修改本清单列出的路径。
- [ ] 在 [`docs/feature/reports/library/layout.md`](../docs/feature/reports/library/layout.md) 把 `columns` 的不可实现 TypeScript 表述改成运行时校验；保留 `GridProps.columns: number`。
- [ ] 在同一 Feature 文档补齐 `TableColumn.maxLines?: number`：只约束 text 数据格的最大物理行数，超出以 `…` 收口，表头与 web 面不消费；同步字段表和渲染契约，不改变当前代码语义。
- [ ] 在 [`docs/engineering/testing/unit/reports.md`](../docs/engineering/testing/unit/reports.md) 的“Table 与文本排版原语”登记且只登记以下新增场景：
  - Grid 展平数组 / Fragment、空分支不占格，任意 ReportNode 可作 cell，Col 内多个 Stat 保持同一格。
  - `columns` 为 0、负数、小数、NaN 或 Infinity 时给完整用户反馈；1 和大于实际 cell 数正常；variant / density 默认 plain / regular。
  - web 初始 HTML 含全部格、稳定 root/cell/variant/density class 与最大列数事实，无 JS 也完整可读。
  - text 宽面使用声明列数，目标示例恰好 100 显示列时降为三列，继续变窄降为一列；声明序、label/value/detail 全保留。
  - boxed / plain、regular / compact 的双面差异；每个 boxed cell 四边完整，compact 不合并或删除字段。
  - Stat 的 LocalizedText、number、null、0、detail 省略和四种 tone；tone 只作用主值且不自动推导。
  - Section.meta 的 web 同行/换行、text 同行右对齐/缩进换行，以及省略 meta 的旧行为。
  - 同一公开报告文件经 show / view 渲染同一批终值，不要求布局逐字一致。
- [ ] 在 [`src/report/definition/primitives.tsx`](../src/report/definition/primitives.tsx) 把文件头清单改为十个原语；新增并导出文档穷尽声明的 `GridProps`、`StatProps`，只给 `SectionProps` 增加 `meta`，不添加未声明 prop。
- [ ] 新增 `src/report/definition/grid-layout.ts`，严格实现 [Architecture · 排版原语的语义层与面内布局](../docs/feature/reports/architecture.md#排版原语的语义层与面内布局)；该文件只放同步纯函数和中间类型，不 import show / view、Results IO 或 stylesheet。
- [ ] 在 `grid-layout.ts` 实现 `normalizeGrid`：校验并规范化 columns / variant / density，递归展开数组与 React Fragment、跳过 null/undefined/boolean、保留声明序和已有 element key；不要把 Fragment 自身或 Col 内部 children 各算一格。
- [ ] 在 `grid-layout.ts` 实现共享 columns 校验，要求 `Number.isFinite(columns) && Number.isInteger(columns) && columns > 0`；web/text 调同一处，错误写出收到的值、原因和 `columns={N}` 下一步。
- [ ] 在 `grid-layout.ts` 定义 `TextGridPlan` 并实现一次性规划：输入只有 availableWidth、cellCount、columns、variant、density；输出实际列数、每格外框/内容显示宽度、row-major cell index 与 gutter。规划不得调用 `ctx.render`，不得为试探候选列数重复执行子组件。
- [ ] `TextGridPlan` 先扣除 boxed 四边框、左右 padding 与 gutter，再从 `min(columns, cellCount)` 向 1 选择每格至少 24 显示列内容宽的最大列数；一列无条件接受。整除余数从左到右各补一显示列，保证整行 `stringWidth <= availableWidth`。
- [ ] 实现共享 Stat 显示值规范化：LocalizedText 走 `resolveLocalizedText`，number 走当前 locale 的 `Intl.NumberFormat`，null 为 `—`，数字 0 保持 `0`；两个面不各写一套。
- [ ] 实现 `Stat.web`：root 为稳定 `nre nre-stat`，固定 label/value/可选 detail 子节点；tone 落语义 modifier 且只影响 value，`className` 只挂 root。
- [ ] 实现 `Stat.text`：label → value → detail 逐行，detail 省略不留空行；三类字段都按传入内容宽度折行并左对齐，不打印 tone 内部名称。
- [ ] 实现 `Section.web` 的 header/title/可选 meta 语义结构；meta 同行右对齐、空间不足换行，body 与旧声明序不变。
- [ ] 实现 `Section.text`：标题和 meta 能放下时同行并把 meta 推到右侧，放不下时标题后以两格缩进折行 meta；body 继续按 `ctx.width - 2` 渲染和缩进，省略 meta 时旧输出不漂移。
- [ ] 实现 `Grid.web`：消费 `normalizeGrid`；每个直接 child 包稳定 cell；root 携带 plain/boxed、regular/compact 和 `--nre-grid-max-columns`；只输出静态 HTML/CSS 所需信息，不使用测量脚本或 hydration。
- [ ] 实现 `Grid.text`：
  - 只消费 `normalizeGrid` + `TextGridPlan`；展平后 0 格输出空串，确定 plan 后每个 cell 只调用一次 `ctx.render(child, contentWidth)`。
  - 按 row-major 组排，最后一排不重排；同行 cell 顶对齐，短 block 底部补空行，所有 padding 都按 `stringWidth` 而不是 `.length`。
  - boxed 给每个 cell 独立完整的 `┌─┐ / │ │ / └─┘`，同行 box 以 regular=2 / compact=1 显示列 gutter 分开，换排重起完整 box；plain 只去掉框与内 padding。
  - label/value/detail 都按内容宽折行；不跨 cell 对齐 Col 内第 N 个子节点，不探测自定义组件语义；任何 cell 不隐藏、不截断、不改声明序。
  - 目标完整示例在恰好 100 显示列稳定为三列，逐行 `stringWidth <= 100`；Section 内缩进后的可用宽度以传入 ctx 为准，Grid 不反推宿主宽度。
- [ ] 在 [`src/report/assets/styles.css`](../src/report/assets/styles.css) 增 Section header/meta、Grid、Stat 规则；不复制进 `src/view/styles.css`：
  - CSS Grid 宽面不超过声明列数，容器变窄自动减列，不产生页面级横向滚动。
  - boxed 的每个 cell 独立完整四边框并以 gap 分开；对任意 columns 和响应式换行都正确，不需要且不能写死 `nth-child(6n)`。
  - regular/compact 分别定义 cell padding、gutter 与 Stat value 字号；一个 Col 内多个 Stat 只有垂直留白，无内部格线。
  - label/detail 用弱化层级，value 用 tabular numerals；positive/negative/warning/neutral 只给 value 状态色。
  - 只适配当前已有样式变量；不借此迁移主题 token 或实现 ReportTheme。
- [ ] 在 [`src/report/index.ts`](../src/report/index.ts) 把注释改成十个原语并公开导出 `Grid` / `Stat` / `GridProps` / `StatProps`；保持 `niceeval/report/react` 不变。
- [ ] 更新或新增 TSDoc 时运行生成器并检查公开 reference；不手改 GENERATED 区块，不带入无关生成漂移。
- [ ] 在 [`src/report/runtime/dual-render.test.tsx`](../src/report/runtime/dual-render.test.tsx) 实现已登记场景，优先断言短小结构事实和局部 text，不做整页巨型 snapshot。
- [ ] 测试 Grid children 的数组、Fragment、false、null、Col 内两个 Stat 和非 Stat cell；两面顺序一致，空分支不占 cell。
- [ ] 测试 columns 的 0、负数、小数、NaN、Infinity、1 和大于 cell 数；错误必须是完整用户反馈。
- [ ] 测试 Stat 的 en/zh-CN、number locale、null/0、detail 有无、四种 tone class；text 不出现 `positive`/`negative` 等内部词。
- [ ] 测试 Section.meta 的 web DOM 和 text 同行/换行；省略 meta 的旧 Section 结果保持。
- [ ] 测试 Grid text 的宽面、恰好 100 列、单列、长字段折行和 CJK label；逐行断言显示宽度不越界、每个 boxed cell 四边完整，并逐个断言 21 个 Stat 都存在且索引顺序递增。
- [ ] 测试 Grid web 初始 HTML 的 root/cell/variant/density/列数事实和全部静态值；不能出现本组件引入的 script/hydration 标记。
- [ ] 在 [`test/fixtures/report/exam-report.tsx`](../test/fixtures/report/exam-report.tsx) 通过公开 `niceeval/report` import 增一个最小 `Section meta + Grid + Stat` 区块，避免只从源码相对路径测试。
- [ ] 扩展 [`src/view/view-report.test.ts`](../src/view/view-report.test.ts) 现有“show --report 与 view --report 吃同一个报告文件”用例：两面都有相同 meta/label/value/detail；web 有 Grid 结构，text 减列后无遗漏；不另造重复宿主测试。
- [ ] 更新 [`docs-site/zh/reference/report-components.mdx`](../docs-site/zh/reference/report-components.mdx)：排版原语从六个补全为十个；写清 Grid/Stat/Section.meta、null/tone/columns 边界和一个短示例；同步公开 Table 的 `maxLines` 字段。
- [ ] 更新 [`docs-site/zh/tutorials/custom-reports.mdx`](../docs-site/zh/tutorials/custom-reports.mdx)：加入自由摘要格任务，把“非表格都要 defineComponent”收窄为“Grid/Stat 覆盖 label-value 摘要，其它自绘形态才需要 defineComponent”；不复制 Feature 的整幅输出示意。
- [ ] 如果实现 helper 的物理位置与 [`docs/source-map.md`](../docs/source-map.md) 当前映射不同，改 Source Map 指向真实位置；否则只核对原语清单为十个且无“已映射未实现”。
- [ ] 收口非 theme 宿主依赖 gap：新增 `src/report/runtime/host.ts` 承接 `loadHostReport`、`buildHostReportMeta`、`localizeText`、`renderHostPageText/Html`；`showCommand` 留在 show 自己的 terminal helper；更新 view/show import、build 入口、测试与 Source Map，`rg 'show/report-host' src/view` 必须为空。
- [ ] 收口 `pairsByFlag` gap：先在 cases 登记“跨旧 experiment group 仍按 input Scope + 可比配置配对”和“自动 label 使用完整 a id、排序使用末段”；再删除 bucket 中的 `experimentGroupOf`，修 label，跑 metric compute / dual render 相关测试。
- [ ] 收口 data validator gap：先按组件族登记旧/畸形 data 的字段路径错误场景；提炼可组合 validator，覆盖所有公开 data shape 的 required 字段、数组元素、判别联合与嵌套 MetricCell/Tally，不只检查顶层哨兵；错误保持完整用户反馈且不让 renderer 抛 TypeError。
- [ ] 修正 Source Map 的不存在 `attempt-route.ts` 与 view brand 旧描述，并把新增 `grid-layout.ts`、中性 report host facade 映射到真实位置。
- [ ] 完成实现后顺序执行并全部通过：
  - `git diff --check`
  - `pnpm run typecheck`
  - `pnpm run build:report`
  - `pnpm run view:build`
  - `pnpm test src/report/runtime/dual-render.test.tsx src/view/view-report.test.ts`
  - `pnpm test`
  - `pnpm docs:reference`（TSDoc/生成参考输入有变化时）
  - `pnpm run docs:validate`
  - `pnpm run docs:links`
- [ ] 若沙箱内 `pnpm test` 因 HTTP server 监听 `127.0.0.1` 报 `EPERM`，在允许监听的环境原样复跑；不得删除/跳过测试或把 EPERM 当功能失败。
- [ ] 最终直接复制目标文档完整示例做类型与双宿主核对：view 宽面为 6 + 9 格并能响应式减列，show 恰好 100 列为三列且每行显示宽度不越界，21 个 Stat 全部存在，tone/null/0/meta 语义符合文档。
- [ ] 收尾再次检查 `git status --short`、未暂存 diff 与暂存 diff；显式路径提交，只包含本 TODO 的实现，不带 theme 或其它并行改动。

## Definition of Done

以下条件必须同时成立：

1. 目标文档 API 无需用户自写 `defineComponent` 或 CSS 即可运行。
2. Grid / Stat / Section.meta 全部在共享 report runtime 中实现，show / view 无重复 renderer 或宿主条件分支。
3. web 初始 HTML 无 JavaScript 完整可读；text 任意宽度不丢 cell、不改顺序。
4. tone、null、0、本地化、compact/boxed、非法 columns 与 Section.meta 都有登记场景和实现测试。
5. Feature、cases、公开类型与公开中文文档对 `TableColumn.maxLines` 只有一份一致契约。
6. 外部 `niceeval/report` fixture 经预编译 dist 在 show / view 两宿主通过。
7. typecheck、report build、view build、全量 test、docs validate 与 links 全绿。
