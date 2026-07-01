# View —— 本地结果查看器(`niceeval view`)

控制台和 `summary.json` 是「当下」的;`niceeval view` 是「事后看图」——不连任何外部服务,只读 `.niceeval/<时间戳>/` 这些结构化工件(见 [Observability](observability.md#结果可视化niceeval-view))。

```sh
niceeval view                         # 起本地 web,自动打开浏览器,读 .niceeval/ 下所有历史运行
niceeval view .niceeval/<run>/summary.json
niceeval view --no-open               # 只打印 URL,不打开浏览器
niceeval view --out .niceeval/report.html  # 导出静态 HTML
```

架构上是**一次性烘焙进单个 HTML+JSON 的静态产物**(`src/view/index.ts` 的 `renderHtml`),不是常驻的多页面 server——`niceeval view` 起的 web 服务每次请求现读现渲染,`--out` 则直接导出成一个可以当 CI 附件传、单文件分享的 HTML。这是刻意的取舍,详见 [References](references.md#调研过判断不值得抄的及理由)。

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
- [References](references.md#vercel-agent-eval--packagesplayground) —— 这次调研 agent-eval playground 的完整记录。
- [Experiments](experiments.md) —— `experimentId`、可对比组、`niceeval exp` 怎么产生这些历史快照。
