# View —— 本地结果查看器(`niceeval view`)

控制台和 `summary.json` 是「当下」的;`niceeval view` 是「事后看图」——不连任何外部服务,只读 `.niceeval/<时间戳>/` 这些结构化工件。结果保存格式见 [Results Format](results-format.md),数据来源见 [Observability](observability.md#结果可视化niceeval-view)。

```sh
niceeval view                         # 起本地 web,自动打开浏览器,读 .niceeval/ 下所有历史运行
niceeval view .niceeval/<run>/summary.json
niceeval view --no-open               # 只打印 URL,不打开浏览器
niceeval view --out .niceeval/report.html  # 导出单文件静态 HTML
niceeval view --out site                   # 目录式静态导出:index.html + artifact/
```

架构上是**一次性烘焙进单个 HTML+JSON 的静态产物**(`src/view/index.ts` 的 `renderHtml`),不是常驻的多页面 server——`niceeval view` 起的 web 服务每次请求现读现渲染,`--out` 则直接导出。这是刻意的取舍,详见 [References](references.md#调研过判断不值得抄的及理由)。

`--out` 按目标形态分两种(`isSingleFileOut`):`*.html` 导出单文件,可当 CI 附件传、单文件分享,但工件视图(代码/transcript/trace)降级;目录则额外把前端会 fetch 的三类工件(`sources.json` / `events.json` / `trace.json`)复制到 `<out>/artifact/<base>/`,与本地 server 的 `/artifact/<rel>` 路径路由同一布局,同一份前端产物在两种托管下用同一个相对 URL(`src/view/app/lib/artifact-url.ts`)。`diff.json` / `o11y.json` 刻意不复制:查看器从不读取,且 diff 可达上百 MB,带上只会拖垮静态部署体积。

## 结果版本机制

`niceeval view` 读取的是已经落盘的报告,而报告会比 CLI 活得更久:用户可能几个月后打开 `.niceeval/<run>/summary.json`,也可能把 CI 产物下载到另一台机器上看。所以 view 的版本策略要优先保证两件事:

1. 新版本 CLI 不轻易丢下旧报告。
2. 真读不了时,错误信息要告诉用户「该用哪个版本看」或「这份历史结果可以删掉」。

具体设计:

- **报告自己带版本。** `summary.json` 顶层放 `format: "niceeval.results"`、`schemaVersion` 和 `producer.version`,设计见 [Results Format · 版本与升级设计](results-format.md#版本与升级设计)。没有这些字段的现有报告视为 legacy v0。
- **view 有一个支持区间。** 例如当前 view 支持 `schemaVersion` 0 和 1。支持区间写在 loader 常量里,不要散落在 React 组件里。
- **先 normalize,再渲染。** `readSummary` 不直接返回磁盘 JSON,而是走 `normalizeSummary(raw, path)`。legacy v0、v1、未来 v2 都在这里转成 view 内部统一模型;`aggregateRows`、`AttemptModal`、`TracesPage` 只吃 normalized model。
- **未知字段不是错误。** 新增 `git`、`environment`、`agentSetup`、`classification` 等字段时,旧 view 可以忽略;新增 artifact kind 也只是不展示。只有必需字段缺失、字段类型错误、或 `schemaVersion` 超出支持区间才算版本/格式错误。

### 报错与降级

`view` 有两种入口,错误处理不同:

- **读整个 `.niceeval/` 目录。** 遇到某个 run 读不了,不要让整个页面失败。loader 应收集 `skippedRuns[]`,继续渲染其它 run,并在页面顶部显示一条可展开提示:哪些 `summary.json` 被跳过、原因是什么、建议怎么处理。
- **读单个 `summary.json`。** 这是用户明确指定的目标,读不了就应该让命令失败,打印可执行的下一步,不要打开一个空页面。

错误分类:

| 场景 | 行为 | 文案要点 |
|---|---|---|
| 没有 `format` / `schemaVersion`,但有 `results[]` + `startedAt` | 按 legacy v0 读 | 可弱提示「旧格式报告」,不阻断 |
| `format` 不是 `niceeval.results` | 跳过或失败 | 说明这不是 niceeval 报告 |
| `schemaVersion` 小于最低支持版本 | 跳过或失败 | 建议用写出该报告的 `producer.version` 打开,或先导出/归档后 `niceeval clean` |
| `schemaVersion` 大于当前支持版本 | 跳过或失败 | 建议升级 niceeval,或用报告里的 `producer.version` 对应版本打开 |
| 必需字段坏了,例如 `results` 不是数组 | 跳过或失败 | 说明报告可能损坏,给出文件路径 |
| attempt 工件缺失,例如 `events.json` 不存在 | 页面仍可打开 | 只在展开该 attempt 时显示「artifact missing」 |

命令行错误要给到具体命令,例如:

```text
Cannot open .niceeval/2026-07-02T03-10-24-123Z/summary.json.
This report was written by niceeval 0.12.0 with results schema 3,
but this viewer supports schema 0-1.

Try:
  npx niceeval@0.12.0 view .niceeval/2026-07-02T03-10-24-123Z/summary.json
  pnpm dlx niceeval@0.12.0 view .niceeval/2026-07-02T03-10-24-123Z/summary.json

If you no longer need historical reports:
  niceeval clean
```

如果 `producer.version` 缺失,文案退化成「upgrade niceeval」或「try an older niceeval matching when the report was created」,不要编造版本号。

### 迁移策略

默认不做隐式迁移。理由:

- eval 结果是审计材料,原地改写会让「当时到底写出了什么」变模糊。
- view 是读工具,不应该因为用户想看报告而修改 `.niceeval/`。
- 大多数版本不需要迁移:新增字段、未知 artifact、UI 展示变化都可以通过兼容 loader 解决。

真正需要迁移时再加显式命令,并且默认写到新目录:

```sh
niceeval migrate-results .niceeval/<old-run>/summary.json --out .niceeval/<new-run>/
```

迁移命令只解决「旧格式还能确定转换到新格式」的情况;如果某份报告依赖旧版本 view 的展示逻辑,更好的建议仍然是:

```sh
npx niceeval@<producer.version> view .niceeval/<run>/summary.json
```

`niceeval clean` 不是迁移工具,只负责删除当前项目的历史运行结果。它适合用户明确表示「旧报告不要了,只想让 view 干净」的场景;不应该在 view 报错时自动执行。

## 现状(已实现)

- **三个 tab**:Experiments(按 `experimentId` 聚合的对比榜单,`GroupSelector` 选组、`ExperimentTable` 展示同组内配置并排,点开一行钻到 eval / attempt 级明细)、Runs(所有 run 打平成一张表)、Traces(trace 瀑布图)。
- **运行总览指标** —— pass / fail / error / skip 计数、总 token、总 $。
- **eval attempt 钻取** —— `AttemptModal` 点开单个 attempt 看断言、错误、耗时、用量、transcript、trace。
- **trace 瀑布图** —— 把 `trace.json` 画成时间轴瀑布,只读 canonical(`gen_ai.operation.name` → `kind`、`gen_ai.*`),不认任何原生 span 名,所以不同 agent 的图天然对齐、可叠加对比。

## 已知的文档 vs 实现差异

这两条之前被 [Observability](observability.md) 的能力列表当成已实现的写了,这次审查代码(`src/view/index.ts`、`src/view/app/`)发现对不上,已经从那边挪过来,归到下面「计划中」:

- **"跨运行趋势"实际是合并,不是可对比的历史。** `aggregateRows`(`src/view/index.ts`)把 `.niceeval/` 下**所有**历史 `summary.json` 按 `experimentId` 揉进同一行——通过率、平均耗时、成本都是跨全部历史 run 的累计值,不是"最新一次"或"某一次"的快照,更谈不上画成随时间变化的线。
- **"质量 × 成本散点图"没有实现。** `src/view/app` 下没有任何图表 / scatter / canvas 组件,现有可视化都是表格和文字指标。

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

**跟 niceeval 的差异(为什么不能直接照搬这套形状):** playground 是多页面、每次请求都读 fs 的 live Next server;niceeval `view` 是一次性烘焙进单个 HTML+JSON 的静态产物(见上文"架构上"一段)。playground 靠"存储层本来就是每次 run 一个新目录"天然拿到历史身份;niceeval 现在的 `aggregateRows` 反而是**主动把**同一个 `experimentId` 的所有历史 run **合并**成一行(见上文"已知的文档 vs 实现差异")。所以 niceeval 要做 Compare,抄的是"保留快照身份、不要提前合并"这个**原则**,不是 playground 的目录结构或 API 形状——数据仍然得在生成 HTML 那一刻就把所有候选快照的统计算好塞进 `viewData`,不能假设前端能像 playground 一样随时再去问 fs。

调研时更完整的"抄了什么 / 为什么不抄"决策记录见 [References](references.md#vercel-agent-eval--packagesplayground)。

## 计划中的小功能

### 结果版本提示与跳过列表

实现上先补 loader,再补 UI:

1. `loadSummaries` 返回 `{ loaded, skipped }`,其中 `skipped` 记录 path、reason、detected `schemaVersion`、detected `producer.version`。
2. `readSummary` 拆成 `parseSummary` + `normalizeSummary`。normalize 支持 legacy v0 和当前 v1。
3. 目录入口继续渲染已成功读取的 run,页面顶部增加可展开的 skipped report 提示。
4. 单文件入口遇到不兼容 schema 时直接退出,打印上文的 `npx niceeval@... view ...` 建议。

这比一开始就做 migration 更实际:多数用户只是想看当前报告;旧报告读不了时,用写出它的旧版本 viewer 打开比自动转换更可控。

### Compare —— 挑两次运行对比

跟 `experiments/compare/`(文档里"一组可对比实验"的示例文件夹名,见 [Experiments](experiments.md#实验怎么组织文件夹--一组可对比的实验))是两回事,别混——这里指 view 里一个新增的小 tab。

**动机:** 上面"已知的文档 vs 实现差异"提到的问题——现在选不出"这次 vs 上次",只有累计历史。参考对象是上面[外部参考](#agent-eval-playground)里的 playground `/compare` 页。

**数据模型:** 现有的 `rows`(累计视图)继续服务 Experiments / Runs / Traces 三个 tab——"这个 agent 整体现在什么水平"仍然是合并全部历史更有用的默认视图,不动它的语义。新增一份**不合并**的快照列表,按 `(experimentId, startedAt)` 索引,每个快照携带该次 run 里这个 experiment 的 eval 级统计(复用 `evalLevelStats` 的输出形状)。这份数据随 `viewData` 一起烘焙进静态 HTML(不像 playground 能按需查 fs)。

**UI:** 在 `src/view/app/App.tsx` 的 `navItems` 加一个 `compare`。两个下拉选"快照"(`experimentId @ startedAt`),不限制两边必须是同一个 `experimentId`;选完出整体通过率 / 平均耗时 / 总成本三个 KPI delta,加一张 per-eval 并排表(复用现成的 `outcomeOf` / `formatPercent` / `formatDuration` / `formatCost`)。只跑过一次、没有历史快照时,下拉只有一项,提示"再跑一次才能对比",不报错。

**明确不做的:** 不做时间序列折线图(历史快照一多不适合塞进单个静态 HTML,而且这次要补的是"挑两点"这个最小能力);不改 Experiments tab 现有的"累计历史"默认语义(这是另一个值得讨论的问题,不在这次一起改)。

### 质量 × 成本散点图

之前文档写过、实际没做。没有具体设计,先记一句:每个 eval(或每个 agent)一个点,一眼看出"贵且不准"的角落——值得补,但优先级低于 Compare。

### Eval 目录页

独立于"跑过的结果",单纯浏览 `evals/` 目录下每个 fixture 的 `PROMPT.md` 和文件列表,不用先跑一次才能看"有哪些 eval、prompt 写的什么"(learnings 见 [References](references.md#vercel-agent-eval--packagesplayground))。没有具体设计,优先级低于 Compare。

## 相关阅读

- [Observability](observability.md#结果可视化niceeval-view) —— 事件流、trace、usage/cost 这些 view 渲染的数据从哪来。
- [Results Format](results-format.md) —— view 读取的 `.niceeval/<run>/summary.json` 与 attempt 级 JSON 工件。
- [References](references.md#vercel-agent-eval--packagesplayground) —— 这次调研 agent-eval playground 的完整记录。
- [Experiments](experiments.md) —— `experimentId`、可对比组、`niceeval exp` 怎么产生这些历史快照。
