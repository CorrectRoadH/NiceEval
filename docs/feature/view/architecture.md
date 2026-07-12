# View —— 架构

结果版本机制的内部设计、参考过的外部实现,以及 view 怎么用 Reports 积木搭出报告槽 + 证据室。CLI 面的报错文案见 [CLI](cli.md)。

## 结果版本机制

`niceeval view` 读取的是已经落盘的快照,而快照会比 CLI 活得更久:用户可能几个月后打开某个快照的 `snapshot.json`,也可能把 CI 产物下载到另一台机器上看。所以 view 的版本策略要优先保证两件事:

1. 新版本 CLI 不轻易丢下旧快照。
2. 真读不了时,错误信息要告诉用户「该用哪个版本看」或「这份历史结果可以删掉」。

具体设计:

- **快照自己带版本。** `snapshot.json` 顶层放 `format: "niceeval.results"`、`schemaVersion` 和 `producer.version`,设计见 [Results · 版本与升级设计](../results/architecture.md#版本与升级设计)。历史版本(schemaVersion ≤ 3)把这三个字段放在 run 级 `summary.json` 顶层,读取器据此识别旧落盘;没有 `format` 字段、也不满足 legacy 的 `results[]` + `startedAt` 启发式的,当作无关 JSON 忽略。
- **版本判定只有一份实现。** 版本判定与形状校验住在 `niceeval/results`(`src/results/format.ts` 的 `classifySummary`),view 经 `openResults` 消费,不自带 loader 常量,更不散落在 React 组件里。
- **先分类,再渲染。** 磁盘 JSON 经 `openResults` 分流:能读的成为快照层次,读不了的进 `skipped`(三种原因);前端组件只吃 `viewData` 的快照明细与 skipped 条目,统计口径住在报告槽里。
- **未知字段不是错误。** 新增 `git`、`environment`、`agentSetup`、`classification` 等字段时,旧 view 可以忽略;新增 artifact kind 也只是不展示。只有必需字段缺失、字段类型错误、或 `schemaVersion` 超出支持区间才算版本/格式错误。

## 外部参考

### agent-eval playground

**是什么:** Vercel `agent-eval` 项目下的 `packages/playground`,发布为 `@vercel/agent-eval-playground`。一个独立的 Next.js web 应用,`npx @vercel/agent-eval-playground` 直接跑,提供 `/`(总览)、`/experiments`、`/experiments/[name]/[timestamp]`、`/evals`、`/evals/[name]`、`/compare`、`/transcript/[...]` 几个路由。零数据库、零 API 路由——所有页面是 Server Component,`force-dynamic`,每次请求都现读 fs,永远是盘上最新数据。

**怎么做的:**

- `bin.mjs` 解析 `--results-dir` / `--evals-dir` / `--port` 几个 flag,resolve 成绝对路径塞进 `RESULTS_DIR` / `EVALS_DIR` 环境变量,再 `spawn` 包自带的 `next start -p <port>`(注意:README 写的是 `next dev`,实际跑的是 production 的 `next start`)。
- `lib/data.ts` 是所有数据读取的唯一入口,纯 `fs.readdirSync`/`readFileSync`,没有缓存也没有数据库:
  - `listExperiments`/`getExperiment` 递归 walk `results/` 目录树,遇到子目录名匹配 ISO 时间戳(`/^\d{4}-\d{2}-\d{2}T/`)就判定它的父目录是一个 experiment、这些时间戳目录就是它的历史 run 列表。
  - `getExperimentDetail(name, timestamp)` 在某次 run 目录下再递归找带 `summary.json` 的子目录(= 一个 eval 的结果),读 `summary.json` + 每个 `run-N/result.json`。
  - `listEvals`/`getEvalDetail` 递归 walk `evals/` 目录,遇到带 `PROMPT.md` 的目录就判定是一个 eval fixture。
- `/compare`(`components/ComparePage.tsx`,client component)两个下拉框选"某个 experiment 的某次 run",候选项和对应的完整 `ExperimentDetail` 都由服务端预先读好、一次性传给客户端(不是选中后才 fetch)。选中两边后纯前端算 delta:整体 `avgPassRate`/`avgDuration` 对两边的 `evals[]` 取平均相减;per-eval 按 eval name 取并集,逐行对比 `passRate`/`meanDuration`,delta 用颜色区分涨跌。
- **关键点:** "能任意选两次运行对比"完全建立在**目录结构天然保留时间戳身份**上——`results/<experiment>/<ISO-timestamp>/` 从不合并,每次 run 落一个新目录,`getExperiment` 返回的 `timestamps: string[]` 就是完整历史列表,`/compare` 只是在这份现成的列表上做了个下拉选择器 + 前端减法。

**跟 niceeval 的差异(为什么不能直接照搬这套形状):** playground 是多页面、每次请求都读 fs 的 live Next server;niceeval `view` 是一次性烘焙进单个 HTML+JSON 的静态产物(见 [README](README.md)"架构上"一段)。playground 靠"存储层本来就是每次 run 一个新目录"天然拿到历史身份;niceeval 调研当时的 `aggregateRows` 反而是**主动把**同一个 `experimentId` 的所有历史 run **合并**成一行(统计层收编时已修:报告槽改为现刻水位 Selection(`selectCurrentResults`)+ 官方计算函数,历史快照身份保留在 `viewData.snapshots`)。所以 niceeval 要做 Compare,抄的是"保留快照身份、不要提前合并"这个**原则**,不是 playground 的目录结构或 API 形状——数据仍然得在生成 HTML 那一刻就把所有候选快照的统计算好塞进 `viewData`,不能假设前端能像 playground 一样随时再去问 fs。

调研时更完整的"抄了什么 / 为什么不抄"决策记录见 [References](../../references.md#vercel-agent-eval--packagesplayground)。

## 用 Reports 积木重建 view

[Reports](../reports/README.md) 把「自己搭报告页」拆成组件 + 计算函数 + 结果库三种零件之后,view 的定位是:**不是一套并行实现,而是用同一批零件搭出来的「默认报告页 + 证据室」**——用户搭页面用什么零件,view 自己就用什么。view 因此是这套积木的第一个常驻消费者,组件与计算函数的正确性被它天天验证。

分层职责:

| 层 | 实现 |
|---|---|
| 读取层 | [`openResults`](../results/library.md#读openresults):版本分流与形状校验,读不了的落盘进 `skipped`(三种原因),壳渲染成横幅 |
| 统计层 | 全部住在报告槽里:默认报告摆 `MetricScatter` 与 `ExperimentList`;散点可走 selection-form,实验列表由 `ExperimentList.data(selection)` 生成数组后传 `items`;口径是两个宿主共同注入的现刻水位 Selection |
| 渲染层 | 报告槽 = `renderReportToStaticHtml` 的静态 HTML(宿主前置的 `Selection.warnings` 横幅 + 官方组件 web 面 + 渐进增强 runtime + styles.css 内联);前端 React app 只承担证据室与壳(导航、界面语言、修复 prompt 按钮、skipped 横幅) |
| 证据室 | AttemptModal / Traces / Runs / 导航壳——view 的本体,报告积木不重造它们 |

数据与路由契约:

- `__NICEEVAL_VIEW_DATA__`(声明在 `src/view/shared/types.ts`)只携带证据室与壳需要的东西:快照明细(`snapshots`,含 attempt locator / artifact 基址)、`skippedRuns`、项目名与 run 元信息。**不携带 overview / 榜单这类统计产物**——统计口径整体住在报告槽的 HTML 里,报告槽自己算,壳与报告之间没有第二条数据通道。内嵌数据不是承诺的持久化格式,要数据走 [Reports · DX 模拟](../reports/library.md#dx-模拟)自己算——coding-agent-memory-evals 曾用字符串标记从 index.html 里抠内嵌 JSON、再正则消毒构建机路径,那类 hack 的存在本身就是数据契约缺位的证据。
- `#/attempt/@<locator>` 路由,路由参数是不透明的 `AttemptLocator`——at 符号前缀的短确定性编码,由 `{experimentId, 快照 startedAt, evalId, attempt 下标}` 这个不可变元组派生,从不编码快照目录名或数组下标。报告页(前门)与 view(证据室)靠同一个 locator 身份契约打通:reader 打开结果根时建立 locator → AttemptHandle 索引,`ctx.attemptHref(locator)` 落到这条路由;locator 缺失、畸形或撞车是结构化错误,从不回退成「随便挑一个」。旧 `?modal=` 参数保留为只读回退。
- dev server 每次请求现读现渲染,报告文件变更下次请求整页重算(装载走 mtime cache-busting,`src/report/load.ts`);`--out` 时报告页即首页,证据室同站。

明确裁决的取舍(是裁决,不是缺口):

- **实体钻取由三级列表承接。** `ExperimentList`、`EvalList`、`AttemptList` 分别固定展示 experiment、experiment × Eval、Attempt;`.data(selection)` 返回普通数组,作者过滤后传 `items`。`MetricTable` 只负责任意维度 × 指标,没有实体展开职责。
- **跨块全局搜索不做。** 过滤是每张表自己的 filter 框(渐进增强的浏览态);要固定口径的收窄,用位置参数前缀或自定义报告的计算参数。
- **「一次看一组」不迁移。** 内置默认报告是跨整个 Selection 的一张散点加一张实验表,不按实验组分节;只想看一组时用位置参数前缀收窄 Selection,不做组选择器这类界面状态(需要分组分节的报告用自定义 `--report`,`Section` / `GroupSummary` 仍是可用组件)。

界线:**view = 报告槽 + 证据室**。报告槽默认装 `CostPassRateComparison`;自定义报告可复用 `MetricScatter` / `ExperimentList` 或另摆 Eval、Attempt 列表。证据室仍由 Attempt 引用深链进入,view 不长列表过滤配置。

## 相关阅读

- [README](README.md) —— `niceeval view` 是什么、报告槽 + 证据室的定位。
- [CLI](cli.md) —— 结果版本机制报错时终端展示什么。
- [Results](../results/library.md) —— `openResults` 读取层的 TS API。
- [Reports](../reports/README.md) —— view 复用的组件、计算函数与结果库积木。
- [References](../../references.md#vercel-agent-eval--packagesplayground) —— agent-eval playground 调研的完整记录。
