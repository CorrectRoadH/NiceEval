# View —— 本地结果查看器(`niceeval view`)

控制台是「当下」的;`niceeval view` 是「事后看图」——不连任何外部服务,只读 `.niceeval/<experiment>/<快照>/` 下的 `snapshot.json` 与逐 attempt `result.json` 这些结构化 artifact。结果保存格式见 [Results](../results/architecture.md),数据来源见 [Observability](../../observability.md#结果可视化niceeval-view)。

```sh
niceeval view                         # 起本地 web,自动打开浏览器,读 .niceeval/ 下所有历史运行
niceeval view .niceeval/<experiment>/<快照>/snapshot.json    # 单文件模式:只看这一份快照
niceeval view weather                 # 位置参数 = eval id 前缀,收窄报告槽 Selection(与 show 同语义)
niceeval view --run site-data/run     # 结果目录经 --run 递入;--experiment <id> 只看该实验
niceeval view --report reports/exam.tsx       # 报告槽整槽换成自定义报告(与 show 同一文件)
niceeval view --no-open               # 只打印 URL,不打开浏览器
niceeval view --out site              # 目录式静态导出:index.html + artifact/
```

位置参数的判定:指向存在的文件 → 单文件模式(不与 `--run` 或其它位置参数混用);指向存在的目录 → 报错直说走 `--run`;其余按 eval id 前缀。收窄只作用于报告槽(注入报告的 Selection;默认报告的散点与实验表随之收窄),证据室数据恒为全量,attempt 深链在任何收窄下都可达。

架构上是**一次性烘焙进单个 HTML+JSON 的静态产物**(`src/view/index.ts` 的 `renderHtml`),不是常驻的多页面 server——`niceeval view` 起的 web 服务每次请求现读现渲染,`--out` 则直接导出。这是刻意的取舍,详见 [References](../../references.md#调研过判断不值得抄的及理由)。

`--out` 只有目录式一种形态:写 `<out>/index.html`,并把前端会 fetch 的三类 artifact(`sources.json` / `events.json` / `trace.json`)复制到 `<out>/artifact/<base>/`,与本地 server 的 `/artifact/<rel>` 路径路由同一布局,同一份前端产物在两种托管下用同一个相对 URL(`src/view/app/lib/artifact-url.ts`)。`diff.json` / `o11y.json` 刻意不复制:查看器从不读取,且 diff 可达上百 MB,带上只会拖垮静态部署体积。

零可读结果(目录真空,或全部落盘被 skipped)时 `loadViewScan` 抛 `ViewInputError`:本地 server 起不来,`--out` 非零退出、不导出空页面——与 show 的「匹配不到直说」同一原则,同时是 CI 静态发布的守卫(构建失败让托管平台保留上一次部署,空报告不顶上线)。错误逐条列 skipped 目录与原因,niceeval 落盘的 schemaVersion 场景拼出可跑的 `npx niceeval@<版本> view` 命令(`src/view/data.ts` 的 `noReadableResults`)。

发布的站与本地 view 完全一致(所见即所发),不设 `--latest` 之类的发布收窄 flag——结果既已提交进仓库,历史体积成本已被接受,导出再收窄只会让线上站 ≠ 本地站、平添第二种导出语义;发布策划过的 Selection 属于 `copySnapshots` 积木(宿主语言挑选,`view --run` 对着产物看)。公开文档的 CI 发布页(`docs-site/zh/guides/publish-report.mdx`)因此只有一种姿势:`.niceeval/` 提交进仓库(gitignore 排除 `diff.json`)+ `view --out` 一行构建命令,可叠 `--report` 发布自定义报告。

## 报告槽 + 证据室

view = **报告槽 + 证据室**:

- **报告槽(首页)**:由 `renderReportToStaticHtml` 渲染。默认报告 `CostPassRateComparison` 跨整个 Selection 摆一张成本 × 通过率 `MetricScatter`,下面是一份 `ExperimentList`;实验项展开到 Eval,再经证据引用进入 Attempt。默认报告不分组,不含 `RunOverview` / `GroupSummary` / `EvalList` / `AttemptList`。自定义报告可对三个实体列表的 `.data(selection)` 返回数组自行 `.filter()` / `.slice()` 后再传 `items`。`--report <文件>` 整槽替换。
- **证据室**:Runs(所有 run 打平成一张表)、Traces(trace 瀑布图)两个 tab,加 `AttemptModal` 钻取(断言、错误、耗时、用量、transcript、trace)。报告槽里的数字经 `#/attempt/@<locator>` 深链进来,`<locator>` 是不透明的、at 符号前缀的 `AttemptLocator` 短码;证据室数据恒为全量,不随位置参数收窄。
- **trace 瀑布图** —— 把 `trace.json` 画成时间轴瀑布,只读 canonical(`gen_ai.operation.name` → `kind`、`gen_ai.*`),不认任何原生 span 名,所以不同 agent 的图天然对齐、可叠加对比。
- **Copy fix prompt(学 Next.js 16.3 的 Copy prompt)** —— 宿主壳里、报告槽上方的批量按钮:把全部失败(含 artifact 路径与修复步骤)打包成可直接粘给 coding agent 的英文修复 prompt,从 `viewData.snapshots` 现算,所以默认报告与 `--report` 两种填充下都在;`AttemptModal` 头部有单条版。实现在 `src/view/app/components/CopyControls.tsx` 的 `buildFixPrompt`。
- **横幅**:两类横幅各有唯一出口。skipped run 横幅在壳(读不了的落盘,与 Selection 无关)。Selection 的挑选警告(partial-coverage / stale-snapshot / unfinished-snapshot 及任何未来的按实验警告)由宿主渲染入口(view 的 `renderReportToStaticHtml`、show 的 `renderReportToText`)在报告树输出之前自动前置一条警告横幅——这是宿主级保证,与报告树里有没有 `RunOverview` 无关,任何报告(内置或自定义)渲染时都得到同一条横幅。内置默认报告 `CostPassRateComparison` 不含 `RunOverview`,靠这条宿主级横幅让 `Selection.warnings` 一份不落地出现在报告槽,警告仍只有一个出口。

## 相关阅读

- [CLI](cli.md) —— 命令、位置参数与 `--out` 的精确行为,结果版本报错与降级文案。
- [Architecture](architecture.md) —— 结果版本机制的内部设计、用 Reports 积木怎么拼出 view、agent-eval playground 调研记录。
- [Observability](../../observability.md#结果可视化niceeval-view) —— 事件流、trace、usage/cost 这些 view 渲染的数据从哪来。
- [Results](../results/architecture.md) —— view 读取的快照 `snapshot.json` 与 attempt 级 `result.json` / JSON artifact。
- [Experiments](../experiments/README.md) —— `experimentId`、可对比组、`niceeval exp` 怎么产生这些历史快照。
