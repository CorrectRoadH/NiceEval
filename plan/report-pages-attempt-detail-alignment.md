# PLAN：把 Reports 代码收敛到“只有 page”的目标架构

> 状态：待执行。
>
> 目标契约：当前 `docs/feature/reports/`，尤其是
> [`architecture.md`](../docs/feature/reports/architecture.md)、
> [`library/shell.md`](../docs/feature/reports/library/shell.md)、
> [`library/attempt-detail.md`](../docs/feature/reports/library/attempt-detail.md)、
> [`library/summaries.md`](../docs/feature/reports/library/summaries.md)、
> [`show.md`](../docs/feature/reports/show.md) 与
> [`view.md`](../docs/feature/reports/view.md)。`docs/` 是目标，不以当前代码降格文档。
>
> 面向执行 Agent：按依赖顺序执行；先更新 Reports 用例登记表，再写测试和实现。不要把本计划当成第二份产品契约；字段、空态和文案仍以 `docs/feature/reports/` 为准。

## 1. 这次改造的最终形态

这不是给现有 `AttemptModal` 换一层包装，而是统一内容模型：

1. `ReportDefinition` 只有一个非空 `pages` 列表。普通报告、Attempts、Traces 和 locator 详情都是 page。
2. page 是判别联合：
   - `input?: "scope"`，规范化后为 `input: "scope"`、`navigation: true | false`；
   - `input: "attempt"`，必须 `navigation: false`，一份报告至多一张。
3. attempt-input page 由宿主按 locator 注入同一份 `AttemptEvidence`；`show` 和 `view` 只负责寻址与摆放，不拥有详情区块。
4. `AttemptDetail` 与 `ExperimentComparison` 都是 report-only 组合组件。它们没有独立 data 类型、web renderer 或 text renderer，只装配公开叶子组件。
5. `ExperimentComparison` 固定组合 `ScopeSummary + MetricScatter + ExperimentList`；删除 `ExperimentComparisonData`、`experimentComparisonData` 和 `niceeval/report/react` 的同名导出。
6. attempt 详情的叶子组件从 `niceeval/report` 导出 spec/data 形态，从 `niceeval/report/react` 导出只收 data 的纯 web renderer。叶子组件不 fetch artifact；事实由 `loadAttemptEvidence` 一次装好。
7. `standard` 有四张 page：前三张进导航，第四张是具名导出的 `standardAttemptPage`。`extends: standard` 继承完整四张 page。
8. 报告没有 attempt-input page 时，locator 在 web/text 两面都是普通文本；宿主不偷偷回退到内建详情。
9. `view` 的 baseline locator 链接指向 `attempt/<encoded-locator>.html`。该文件无 JavaScript 时也完整可读；dialog 只是加载并摆放同一份 page 输出的增强层，不再调用私有 `AttemptModal` 内容实现。
10. `niceeval/report` 的装载、definition 品牌、resolve 和两个 renderer 使用同一份 package-owned runtime；删除 show/view 中的重复类型、旧 runtime fallback 和多处 `dist` 探测。

## 2. 当前 docs / code 差异审计

| 契约面 | docs 目标 | 当前代码 | 必须改什么 |
|---|---|---|---|
| page 类型 | `input` / `navigation` 判别联合，至多一个 attempt page | `src/report/report.ts` 的 `ReportPage` 只有 `id/title/content` | 扩展公开类型、规范化、装载校验与 `ReportMeta.pages` |
| 当前 page 上下文 | `ctx.page` 区分 scope / attempt，attempt 分支带 locator + evidence | `ComposeContext` 没有 `page`；`ResolveContext` 只有 Scope input | 把 `PageContext` 贯穿 resolve、compose、text/web render |
| locator 连接 | 当前 definition 有 attempt page 才提供命令/链接 | `attemptCommand` / `attemptHref` 始终存在并默认指向内建宿主路由 | 改为可选；宿主根据 definition 注入，所有 locator renderer 支持纯文本退化 |
| 内建报告 | 四张 page，第四张为 `standardAttemptPage` | `src/report/built-in/standard.tsx` 只有三张 page | 新增并具名导出第四张 page；导航仍只有前三张 |
| `ExperimentComparison` | 普通组合件，无独立 data / renderer | 独立 `ExperimentComparisonData`、计算函数、text face、React renderer | 改为 `defineComponent` 组合并删除整个旧数据面 |
| Attempt 组件 | 11 个叶子 + `AttemptAssessment` / `AttemptDetail` 两个组合 | 详情集中在 `src/view/app/components/AttemptModal.tsx`、`CodeView.tsx`、`Trace.tsx` 等私有 UI | 按事实边界迁入 report 组件族，补双面叶子与公开导出 |
| Results evidence | report 叶子只消费一次装好的事实 | `loadAttemptEvidence` 已存在，但 view 仍把瘦身结果序列化后在浏览器 fetch sources/events/trace | 让 page resolve 直接消费 `AttemptEvidence`；移除详情内容的二次 fetch / 重解释 |
| `show @locator` | 无证据 flag 时渲染当前 definition 的 attempt page text 面 | `src/show/index.ts` 在装载报告之前直接调用 `attemptOverviewText` | 改分流顺序；证据 flags 保留 Results 的专用投影 |
| `view` 详情 | 参数化 page 的静态文档；dialog 只摆放同一输出 | React App 固定渲染 `AttemptModal`，内容和 report 无关 | 产出 per-locator HTML，删除固定内容组件，保留通用 dialog/history 增强 |
| 站点产物 | `index.html` + 可选 `attempt/*.html` + assets/artifact | `planSite` 只产出一个 `index.html` 与 artifact | 扩展 `SitePlan`、相对 URL、server/export parity 与 no-JS 路径 |
| runtime 所有权 | report 内核是单一构建单元，宿主只调 facade | `src/show/report-host.ts` 重复 Report 类型，并带 legacy definition / dist fallback | facade 下沉到 report runtime；show/view 只保留 CLI/HTTP 编排 |
| 源码组织 | 按 definition/model/component family/runtime/assets 纵切 | `components.tsx`、`compute.ts`、`types.ts`、`text/faces.ts` 横切且持续膨胀 | 行为变绿后迁移到纵切目录，公开 barrel 不变 |
| 测试契约 | 参数化 page 与 report 组件是观察边界 | cases 仍写“三页报告”“view 证据室”“`experimentComparisonData`” | 先重写登记行与 Reports 测试架构，再改测试 |
| 公开文档站 | 用户能声明、自定义并发布 attempt page | docs-site 仍描述固定详情、三页默认报告和旧 `ExperimentComparison.data` | 中文源头先改，再由独立翻译 Agent 同步英文 |

## 3. 执行前先处理的文档内部收口

当前目标方向已经清楚，但实现前需要把两处容易让 Agent 写出两套机制的表述收成单义。只做措辞收口，不改变“详情是一张 page”的决策：

- `architecture.md` 一处写“本地 view 只 resolve 被打开的 page 实例”，而 `view.md` 又要求本地 server 与 `--out` 消费同一站点产物、`index.html` 内含 scope pages、导出含所有 locator pages。执行时以“同一 `SitePlan`、同一路径同字节”为硬不变量：产物清单可延迟计算单个文件内容，server 请求时求值，`writeSite` 则求值全部文件。若 `index.html` 仍内嵌全部 scope page template，就明确这些 scope pages 会一起 resolve；不要让测试同时要求“全内嵌”和“只 resolve 当前一页”。
- attempt page 的初始 HTML 必须完整，叶子 renderer 不 fetch artifact；`artifact/` 可继续按现有发布契约保留给下载、外部链接或增强行为，但 baseline 详情不能依赖它。把 `view.md` 中“网页按需 fetch 证据”的主语收窄，避免执行 Agent又把数据装载搬回浏览器。
- `AttemptConversation` 要按标准事件流分轮，而当前 `AttemptEvidence.execution` 已丢失 message `loc` 等原始分轮信息。先在 Results 契约中选定单一事实形状：推荐给 `AttemptEvidence` 增加只读 `events: readonly StreamEvent[] | null`，由 `loadAttemptEvidence` 已有的那次读取直接保留；不要让组件再次调用 `attempt.events()`。同步 `docs/feature/results/library.md` 与公开类型说明后再实现。

完成本节时，同时新增一条 memory 裁决并更新 `memory/INDEX.md`，记录：

- attempt 详情从“宿主固定路由内容”翻案为“报告中唯一的参数化 page”；
- `ExperimentComparison` 与 `AttemptDetail` 都只是组合件；
- 无 attempt page 即无隐式 locator 目标。

它明确取代 `memory/reports-no-privilege-chrome-rulings.md` 中“attempt 详情保持宿主路由内容”的部分，但不改写历史正文。

## 4. 先改测试设计与场景登记

动实现前，先更新：

- `docs/engineering/testing/unit/reports.md`
- `docs/engineering/testing/unit/reports.md`

登记表至少完成以下替换，不保留两套场景：

1. 删除 `experimentComparisonData()` 场景；改为“`ExperimentComparison` 展开为三个公开叶子，使用同一 input，并按 line label / 显式 props 选择 series”。观察 resolve 后的组件事实与各叶子的既有数据结果，不复制内建 JSX 再做输出 parity。
2. “内建三页”改成“四张 pages / 三张导航”：验证第四张 page 的 `input/navigation/content` 与 `standardAttemptPage` 同引用，default export 与 `standard` 同引用。
3. 把“Attempt 详情（view 证据室）”改成“Attempt 参数化 page 与详情组件”：
   - `AttemptEvidence` 只装载一次，叶子 `*Data` 不 IO；
   - 11 个叶子的非空/空证据矩阵用表驱动覆盖；
   - `AttemptAssessment` 的 source/assertions 二选一；
   - `AttemptDetail` 的声明顺序；
   - text/web 共享同一 data 事实，不逐字比较布局。
4. page 规范化增加：scope 默认值、attempt 必须 `navigation:false`、重复 attempt page、没有 locator 打开 attempt page、初始页与索引只看可导航 pages。
5. locator 增加：有 attempt page 时命令保留 `--results` / `--report`；无 attempt page 时两个面只显示文本。
6. show 增加：无 flag 的 `@locator` 选择参数化 page；证据 flags 绕过 page content；自定义报告无 attempt page 时给完整用户反馈。
7. view 增加：每个有效 locator 生成独立 HTML、收窄决定可达集合、直接页面无 JS 完整可读、dialog 使用同一 page 内容、导航不含 hidden page。
8. site parity 场景把 `attempt/*.html` 纳入 server / `--out` 逐字节比较。

测试文件继续用 `// cases: docs/engineering/testing/unit/reports.md` 绑定登记表。不要新增整页大 snapshot、CSS class 全量 snapshot、复制内建源码的 parity 测试或 grep 私有源码文本的“架构测试”。

## 5. Phase A：统一 report definition、page context 与 runtime facade

### A1. Definition 与规范化

- 在 report 内核定义 `ScopeReportPage` / `AttemptReportPage` 判别联合；`ReportDefinition.pages` 保存规范化后的显式 `input` 与 `navigation`。
- 树 / `content` 缩写精确展开为 `input: "scope"`、`navigation: true`。
- 校验：
  - page id 合法且唯一；
  - pages 非空；
  - attempt page 必须显式 `navigation: false`；
  - 一份 definition 最多一个 attempt page；
  - 其它既有 shell/head/assets 规则不变。
- `ReportMeta.pages` 暴露 `{ id, title, input, navigation }`，删除单独的 `pageId`，当前实例改由 `ctx.page.id` 表达；若 docs 最终仍保留 `pageId`，只允许它是 `ctx.page.id` 的只读镜像，不得成为第二套状态。
- 新增并贯穿 `PageContext`：scope 分支只有 id/input；attempt 分支带 locator/evidence。
- `ResolveContext` 保留 Scope 型默认 `input`，另带 `page`；attempt 叶子的缺省 evidence 从 `page` 判别分支读取。

### A2. 可选 locator target

- `TextContext.attemptCommand`、`WebContext.attemptHref` 改为可选。
- report runtime 根据规范化 definition 是否存在 attempt page决定是否注入默认生成器。
- 组件显式传入 `attemptHref` 的自有 React 场景仍可产生外部链接。
- 盘点 `Table`、Experiment/Eval/Attempt/Failure list、`TraceWaterfall`、`CopyFixPrompt` 等所有 locator 输出；没有 target 时保留 locator 文字与数据，不生成空 href、假命令或内建 fallback。

### A3. 单一 runtime facade

- 把 `src/show/report-host.ts` 中真正共用的装载、规范化、标题、page 选择、text/web render 适配移到 report 的 `runtime/host` 边界，并纳入 `build:report`。
- facade 接收中性 `Results` / `Scope` / 可选 `AttemptEvidence`，不依赖 show/view 类型。
- show/view 只通过这一处 package-owned runtime 调用；同一进程不同时 import raw `src/report/**` 与 `dist/report/**` 的同一状态模块。
- 删除 `LegacyReportDefinition`、旧 build 形态桥接、运行时探测 `renderReportTreeToText` 是否存在等 fallback。`dist/report` 缺失或过期应在 build/typecheck 暴露。
- 保留 package exports：`niceeval/report`、`niceeval/report/react`、`niceeval/report/built-in`；运行时身份由构建与 import 图保证，不靠 `instanceof` 穿越两份模块副本。

### A 验收

- 合法 page 形态类型检查通过，非法组合有 `@ts-expect-error` fixture；无类型 JS 输入有完整错误测试。
- `defineReport({ extends: standard })` 保留 base 的完整规范化 page 引用。
- show/view 不再声明自己的 `HostReport*` 镜像类型。
- `pnpm run build:report` 后再跑 `pnpm run typecheck`，不存在 stale dist 类型身份错误。

## 6. Phase B：把 `ExperimentComparison` 降为普通组合件

- 在 summaries 组件族中用 `defineComponent((props, ctx) => ...)` 实现 docs 给出的组合：
  - `input = props.input ?? ctx.scope`；
  - line label / 显式 `series`、`connect` 的选择只发生在 compose 阶段；
  - 同一个 input 传给 `ScopeSummary`、`MetricScatter`、`ExperimentList`；
  - 透传 locale/className，`ExperimentList` 保持 filter 行为。
- 删除：
  - `ExperimentComparisonData`；
  - `experimentComparisonData`；
  - `src/report/react/ExperimentComparison.tsx`；
  - `src/report/text/faces.ts` 中专属 face；
  - `niceeval/report/react` 的 `ExperimentComparison` 导出；
  - 相关 shape validator、CSS 中只服务专属 wrapper 的规则。
- 更新 `src/report/index.ts`、React barrel、TSDoc/reference 和全部测试/fixture import，不留 beta 兼容别名。
- 保留三个叶子各自的 data 测试；组合测试只证明连接和默认选择，不复测三套数据算法。

## 7. Phase C：建立 Attempt 详情组件纵切

### C1. Results evidence 完整性

- `loadAttemptEvidence` 一次并行读取 events / trace / diff / source，并保留 Attempt 详情全部需要的中性事实；不加入任何 HTML、终端字符串或 view 私有字段。
- 若按第 3 节采用 `events` 字段，更新 `AttemptEvidence`、public `niceeval/results` 导出与现有 evidence 测试；磁盘格式不变，不迁移 `.niceeval`。
- timeline correlation、conversation 分轮、source annotation 只在 Results/o11y 的中性 pure helper 中实现一次；show flags 和 report data 函数复用，不从 view 反向 import。

### C2. 叶子 data 与双面 renderer

在 `src/report/components/attempt-detail/`（最终目录名以 architecture.md 为准）实现：

- `AttemptSummary`
- `AttemptError`
- `AttemptAssertions`
- `AttemptSource`
- `AttemptFixPrompt`
- `AttemptTimeline`
- `AttemptConversation`
- `AttemptDiagnostics`
- `AttemptUsage`
- `AttemptTrace`
- `AttemptDiff`

每个叶子都满足：

- `attempt*Data(evidence)` 是同步或 Promise 均可，但只派生已装好的 evidence，不读文件、不 fetch；
- data 可序列化，缺证据按 docs 返回 `null`；
- spec 形态省略 input 时只从 attempt `ctx.page` 取 evidence；放在 scope page 且没显式 input 时给出带下一步的完整错误；
- web/text renderer 只消费 data；text 可把巨量内容折为摘要 + 专用证据命令，但不得改口径；
- React 入口导出 data-only 组件与 data 类型；report 入口导出 spec/data 组件、函数与类型；
- 新 web 结构使用 `nre-*` 稳定语义类，样式进入公开 report CSS。view 的 Tailwind 只保留 dialog/navigation chrome，不承担详情区块样式。

迁移时优先提炼当前 `AttemptModal.tsx` / `CodeView.tsx` / `Transcript.tsx` / `Trace.tsx` 的纯数据与纯标记逻辑；不要让 report 组件 import `src/view/`，也不要整份复制后留下两套实现。

### C3. 两个组合件

- `AttemptAssessment` 只实现 `AttemptError + (AttemptSource | AttemptAssertions)` fallback。
- `AttemptDetail` 严格按 docs 顺序装配 9 个一级区块，不产生新 data 或 renderer。
- 组合件只从 `niceeval/report` 导出，不从 React 入口导出。

### C 验收

- 同一 `AttemptEvidence` 的 data 结果在 text/web 两面显示相同 verdict、计数、能力位与引用。
- 无 source 的失败 attempt 显示 assertions；有 source 时默认组合不重复 assertions。
- errored/no-trace/no-diff/no-events 等缺失组合不白屏、不伪造空值。
- 删除 view 私有详情内容后，组件测试仍可在 Node 中用静态 render 完整验证，不 mock fetch。

## 8. Phase D：内建报告与 locator 连接

- 新增并导出：

  ```tsx
  export const standardAttemptPage: ReportPage = {
    id: "attempt",
    title: "Attempt",
    input: "attempt",
    navigation: false,
    content: <AttemptDetail />,
  };
  ```

- `standard.pages` 顺序固定为 `report / attempts / traces / attempt`；默认导出仍与 `standard` 同引用。
- 导航、show 页尾索引与 `--page` 可用列表只使用 `navigation !== false` 的 pages。
- `--page attempt` 没有 locator 时按用户错误反馈，不能拿 Scope 强行 resolve。
- `standardAttemptPage` 是普通 page 对象，允许用户在自定义 pages 中复用；不引入 `definePage`。
- locator URL/命令生成必须携带宿主上下文：
  - show：保留 `--results` 与 `--report`；locator 本身选择 attempt page，不额外拼 `--page attempt`；
  - view：首页基线 href 指向相对的 `attempt/<encoded>.html`，增强层另维护 `#/attempt/@locator` 浏览状态。

## 9. Phase E：改造 `show`

- 参数解析仍先识别 `@locator`，但无证据 flag 时不要立刻渲染 `attemptOverviewText`：
  1. 打开 Results 并解析 locator；
  2. 装载当前 `--report` 或默认 `standard`；
  3. 找唯一 attempt-input page；
  4. `loadAttemptEvidence`；
  5. 以 attempt `PageContext` 跑统一 resolve/validate/text render。
- `--source` / `--execution` / `--timing` / `--diff` 继续直接投影 Results evidence，不经 page content；它们不能因自定义报告删掉 attempt page 而失效。
- 自定义报告没有 attempt page且用户运行无 flag 的 `show @locator --report ...` 时，报错说明如何 `extends: standard`、加入 `standardAttemptPage` 或声明自己的 page；不回退到内建详情。
- 只在所有默认首页事实已由 Attempt 叶子 text face 覆盖后，删除 `attemptOverviewText` 及其仅服务默认首页的 helper；证据 flags 仍用的 renderer 留在 show 或下沉到中性 helper。
- 页尾只列其它可导航 pages。隐藏 attempt page 不出现在裸 `show` 的“Other pages”。

## 10. Phase F：改造 `view` 与站点管线

### F1. 站点计划

- `loadViewScan` 对有效根建立去重后的 `AttemptHandle` 集合；只有 definition 声明 attempt page 时才为这些 locator 装配 evidence 和计划页面。
- `SitePlan.files` 新增 `attempt/<encodeURIComponent(locator)>.html`。路径编码/解码集中一个 helper，禁止各处手写。
- 每个 attempt 文件使用同一外壳资产和同一 report runtime 渲染 attempt page web face；正文已经包含 source/assertions/timeline/conversation/trace/diff 的静态内容。
- 所有相对链接按当前文档深度生成：attempt 页引用根 assets/artifact 时使用正确的 `../` 基底；根目录、子目录托管、`file://` 直接打开与 clean URL 测试都要覆盖。
- `writeSite` 与 server 读取同一个 `SiteFile` 内容生产器；`writeSite` 求值全部文件，server 可按请求求值并缓存当前 plan。无论是否延迟，给定同一输入，同一路径字节必须一致。
- 静态导出继续先完整 resolve/validate 再写任何文件；任一 locator page 失败时不能留下半套目录。

### F2. 前端只保留机器

- `ViewReportMeta.pages` 带 `input/navigation`，Tabs 只接收可导航 pages。
- 删除 `ViewResult` 驱动的固定 `AttemptModal` 内容与 browser-side artifact loader；相应缩减 `ViewData.snapshots`，只保留通用路由/增强真正需要的最小索引。不要继续把整份结果复制进客户端作为第二个详情数据源。
- 保留通用 Dialog、关闭/历史/focus trap。打开 locator 时 fetch 对应静态 HTML，提取明确标记的 attempt page content 放入 dialog；直接打开 href 则显示完整文档。
- dialog 与直接页面必须使用同一个 server-rendered content 字节/DOM 片段。禁止维护 `AttemptDetail` 的 React 客户端镜像。
- 官方增强脚本只添加 dialog、排序、过滤、复制、折叠等行为；关掉 JS 后 locator 链接仍能读完整详情。
- `src/view/client-dist/` 只由 `pnpm run view:build` 重建，不手改。

### F3. Artifact 与发布

- 保留当前 `sources/events/trace/diff` 出站规则和 `o11y.json` 排除规则，除非第 3 节的文档收口明确删改；但 Attempt baseline 页面不得依赖浏览器 fetch 才出现事实。
- 收窄后的有效根同时决定 scope pages、attempt pages 与 artifact 集；范围外 locator 不生成页面。
- 本地 server 对未知 `attempt/*.html` 返回 404，不越过有效根或回读完整未收窄结果。

## 11. Phase G：按功能纵切 report 源码

行为测试变绿后再做机械迁移，避免在定位语义错误时同时追 import：

```text
src/report/
├── definition/          definition、page、tree、component protocol
├── model/               aggregate、metrics、dimensions、format、locale
├── components/
│   ├── summaries/
│   ├── entity-lists/
│   ├── metric-views/
│   ├── attempt-detail/
│   └── site-components/
├── runtime/             load、resolve、validate、host facade、text/web entry
├── built-in/
└── assets/
```

- 每个组件族内部放 data type、计算、spec/data 装配、text face、web face；只把真正跨族的类型下沉 model。
- `niceeval/report` 与 `niceeval/report/react` 仍由稳定 barrel 提供扁平 API；用户不感知内部目录。
- 删除已经清空的 `components.tsx`、`compute.ts`、巨型 `types.ts`、`text/faces.ts`，而不是留下转发层永久并存。
- CSS / enhance 仍按现有公共子路径发布；若物理文件移到 `assets/`，同步 package exports、view 内联路径、打包清单与 linked-consumer 测试。
- 不写 grep 文件名的架构测试。用公共 import 编译 fixture、package exports 冒烟和不存在宿主反向 import 的类型边界证明结构。

## 12. Phase H：文档、source map、生成物与旧计划收口

- 更新 `docs/source-map.md`：
  - 删除 `experimentComparisonData`、专属 renderer 与三页内建说明；
  - 加 page context、attempt 组件族、runtime facade、per-locator site files；
  - 不再把 Attempt 详情映射到 `src/view/app/components/AttemptModal.tsx`。
- 从源码 TSDoc 运行 `pnpm run docs:reference`，检查公开 API 生成区。
- 按 `docs-site/AGENTS.md` 先更新中文：
  - `zh/tutorials/custom-reports.mdx`
  - `zh/reference/report-components.mdx`
  - `zh/tutorials/viewing-results.mdx`
  - `zh/tutorials/publish-report.mdx`
  - `zh/troubleshooting/debugging.mdx`
  - `docs-site/AGENTS.md` 术语表中的默认报告说明
- 中文定稿后由另一个翻译 Agent 同步对应英文页；英文侧不单独发明 API。
- 搜索并删除公开文档里的旧写法：`ExperimentComparison.data`、`experimentComparisonData`、固定三页报告、`--report` 不影响详情、view 私有证据室。
- 在旧 plan 顶部标注取代关系，避免后续 Agent 误执行：
  - `plan/reports-redesign-implementation.md` 第 48/51 条的宿主 attempt 详情；
  - `plan/view-attempt-detail-evidence-first.md` 的 `src/view/app` 内容归属；
  - `plan/show-view-equivalence.md` 中旧默认报告/证据室边界；
  - `plan/attempt-evidence-feedback-loop.md` 中要求保留宿主默认 Attempt 首页的部分。

## 13. 相关仓库 `/Users/ctrdh/Code/coding-agent-memory-evals`

### 影响结论

需要联动，但不是全仓迁移：

| 文件/边界 | 是否更新 | 原因 |
|---|---|---|
| `reports/memory.tsx` | 主体不改 | 它 `extends: standard`，会自动继承第四张 hidden attempt page；需要验证导航仍只有三项、详情自动出现 |
| `reports/memory-conditions.tsx` | **要改** | 它自己声明完整 pages，又包含 `ExperimentComparison` / `FailureList` locator；新契约下必须 import 并追加 `standardAttemptPage`，否则 locator 只能显示文本 |
| `README.md` / `AGENTS.md` | 要同步措辞 | 当前写“默认三页”和“自定义报告后详情仍在”；应写“三张导航 page + 一张参数化详情 page”，并说明自声明 pages 需显式加入详情 |
| `scripts/vercel-build.sh` / `vercel.json` | 命令不改 | 仍是 `niceeval view --report reports/memory.tsx --out site`；`memory.tsx` 已通过 extends 获得详情 |
| `package.json` / `pnpm-workspace.yaml` / lock | 分发布阶段处理 | 本地 override 已指向 sibling niceeval，适合联调；包含本改造的 niceeval 发布后，按仓库注释删除临时 override、抬最低版本并重锁 |
| 已提交 `.niceeval/` 数据 | 不迁移 | 本次只改读取/呈现与内存 evidence，不改 Results Format |

对 `memory-conditions.tsx` 的目标改法：

```tsx
import { standardAttemptPage } from "niceeval/report/built-in";

export default defineReport({
  // shell ...
  pages: [
    // overview / memory / failures ...
    standardAttemptPage,
  ],
});
```

外部仓库当前有大量 `.niceeval/` 删除/新增和实验文件未提交改动。执行 Agent 只能显式编辑上述 report/docs/package 路径；禁止 `git add -A`、清理结果目录或覆盖实验文件。

### 外部仓库版本注意

- `package.json` 声明 `niceeval: ^0.8.0`，但本地 `pnpm-workspace.yaml` override 和 lock 指向 `link:../niceeval`；当前 `node_modules/niceeval` 因此显示 sibling checkout 的 package version，而不是 npm 解析结果。这是预期联调状态，不要把版本字符串误判为实际使用旧包。
- Vercel 脚本安装 `niceeval@latest`，不能验证未发布代码。合并前用 sibling link 验证；发布后再跑一次 clean Vercel 构建或等价的临时目录安装，才能证明线上入口。

## 14. 验证计划

### 14.1 每阶段的快速回路

1. Definition / runtime：

   ```sh
   pnpm exec vitest run src/report/report.test.ts src/show/report-host.test.ts
   pnpm run build:report
   pnpm run typecheck
   ```

2. `ExperimentComparison` / Attempt 组件：

   ```sh
   pnpm exec vitest run src/report/report.test.ts src/report/dual-render.test.tsx src/report/site-components.test.tsx src/report/react/render.test.tsx
   ```

3. show：

   ```sh
   pnpm exec vitest run src/show/show.test.ts
   ```

4. view/site：

   ```sh
   pnpm exec vitest run src/view/view-report.test.ts src/view/data.test.ts src/view/site-parity.test.ts src/view/site-head.test.ts src/view/app/App.test.tsx
   pnpm run view:build
   ```

测试文件迁移后以新路径替换命令，不为保留命令而留下旧文件。

### 14.2 niceeval 全量门槛

按此顺序运行；build 会改变 dist/client-dist，之后必须再 typecheck/test：

```sh
pnpm exec vitest run test/docs-consistency.test.ts
pnpm run docs:reference
pnpm run build:report
pnpm run view:build
pnpm run typecheck
pnpm test
pnpm exec vitest run test/e2e-linked-consumer-report.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
git diff --check
```

`test/e2e-linked-consumer-report.test.ts` 名字虽含 e2e，但它是本仓库无网络的 linked consumer 守护，继续由 `pnpm test` 收集；不要为本次改造另造第三层测试体系。

### 14.3 必须人工/CLI 冒烟的行为矩阵

使用测试 fixture 或 `mktemp -d` 下复制出的结果根，不修改开发者真实 `.niceeval/`：

| 场景 | 预期 |
|---|---|
| 裸 `show` | 渲染 report page；页尾只列 attempts/traces，不列 hidden attempt |
| 裸 `show @locator` | 渲染 `standardAttemptPage` 的 text 面 |
| `show @locator --source/--execution/--timing/--diff` | 仍走专用 evidence 投影 |
| 自定义 report + `standardAttemptPage` | locator 命令保留 `--report` / `--results`，打开自定义定义中的详情 |
| 自定义 report 无 attempt page | locator 显示纯文本；直接无 flag 下钻给明确错误，不回落 standard |
| 裸 `view` | 导航恰为三项；locator baseline href 是 `attempt/*.html` |
| 直接打开 attempt HTML 并禁用 JS | 身份、失败原因、断言/source、时间、diagnostics 等可用内容完整可读 |
| 开启 JS 点 locator | dialog 内是同一 page 内容；关闭/前进/后退状态正确 |
| `view --out` | 每个有效 locator 有一个 HTML；范围外没有；不存在半成品 |
| server 与 export | `index.html`、全部 `attempt/*.html`、assets/artifact 同路径逐字节一致 |

### 14.4 外部 dogfood 仓库

先在 niceeval 完成 `build:report` 与 `view:build`，再到外部仓库；不要提交或清理其已有脏数据：

```sh
cd /Users/ctrdh/Code/coding-agent-memory-evals
pnpm run typecheck
pnpm exec niceeval show --results .niceeval --report reports/memory.tsx
pnpm exec niceeval show --results .niceeval --report reports/memory-conditions.tsx
```

从输出选一个真实 locator，分别验证两个 report：

```sh
pnpm exec niceeval show @<locator> --results .niceeval --report reports/memory.tsx
pnpm exec niceeval show @<locator> --results .niceeval --report reports/memory-conditions.tsx
```

导出必须写到新建临时目录，不覆盖仓库 `site/`：

```sh
pnpm exec niceeval view --results .niceeval --exp compare --report reports/memory.tsx --out <temp-dir>
```

检查：导航三项、`attempt/` 文件数量等于有效根去重 locator 数、随机失败 locator 的直接 HTML 无 JS 可读、文件中没有宿主机绝对路径。发布后再用 clean 环境执行 `bash scripts/vercel-build.sh`，验证 `niceeval@latest` 已包含本契约。

## 15. 完成定义

以下全部成立才算完成：

- [ ] `ReportDefinition` 没有 page 之外的 attempt/modal 内容槽。
- [ ] page 输入、导航与唯一 attempt page 规则在类型和运行期都被证明。
- [ ] `ExperimentComparison` 没有独立 data、renderer 或 React 导出。
- [ ] Attempt 详情全部由公开 report 组件组成；view 不再拥有固定详情内容。
- [ ] `standard` 四张 page、三张导航，`standardAttemptPage` 可被用户复用。
- [ ] 有/无 attempt page 时 locator 的链接、命令与纯文本退化都正确。
- [ ] `show @locator` 无 flag 渲染当前 definition 的 attempt page；证据 flags 行为不变。
- [ ] 每个有效 locator 有 no-JS 可读的静态 HTML，dialog 复用同一输出。
- [ ] server / `--out` 对全部站点文件逐字节一致，收窄不泄漏范围外 attempt。
- [ ] show/view 不再维护重复 Report 类型或 legacy runtime fallback。
- [ ] report 源码按组件族纵切，公开 import 路径保持稳定。
- [ ] Reports `cases.md` 与测试实现一一对应，没有新增未登记测试。
- [ ] source map、memory、中文 docs-site、英文翻译、生成 reference 全部同步。
- [ ] `coding-agent-memory-evals` 的 `memory-conditions.tsx` 显式加入 `standardAttemptPage`；`memory.tsx` 通过 extends 自动继承并验证通过。
- [ ] niceeval 全量门槛与外部 dogfood 矩阵全部通过。

