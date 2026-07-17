# `niceeval view` —— 在浏览器读结果

`niceeval view` 把结果根呈现为本地网页：页面内容全部来自装载的报告定义（不带 `--report` 时是[内建报告](library/built-in.md)的三页——报告、Attempts、追踪），attempt 详情经宿主路由随时可开。它不依赖外部服务。

本地模式与静态导出共用**同一条站点管线**：管线把结果根物化成一份站点产物——`index.html` 加 `artifact/` 证据树的文件清单，每个文件要么是构建时现算的内容，要么指向结果根内的原文件。本地模式把这份产物挂在 `127.0.0.1` 上按路径服务；`--out` 把同一份产物写盘。两个宿主都不携带自己的取数或布局知识，同一路径在两边逐字节一致（由奇偶测试守护）。本地服务只多三条宿主语义，全部作用在管线的输入端而不是产物上：打开首页触发整份产物重建（数据永远是盘上最新，`--report` 文件变更同样在下次请求整页重算，装载走 mtime cache-busting）；单页渲染失败折成该页的错误块、其它页照常可读（导出保持任一页失败整体失败，不产出半套站点）；报告槽可被位置参数 / `--experiment` 收窄（导出与收窄互斥，见「静态导出」）。artifact 请求命中最近一次构建的产物清单，未命中时管线重建一次再查——server 运行期间新落盘的证据不需要重启。

## 打开与收窄

```sh
niceeval view
niceeval view weather                  # eval id 前缀，只收窄报告槽
niceeval view --experiment compare     # 只看 compare 可比组（按路径段匹配）
niceeval view --experiment compare/bub # 只看一个 experiment
niceeval view --results site-data/run  # 换结果根
niceeval view --snapshot .niceeval/dev-e2b_codex-e2b/2026-07-12T10-08/snapshot.json
                                       # 只打开这一份快照
niceeval view --no-open                # 只打印 URL
niceeval view --port 4400              # 固定本地端口
niceeval view --report reports/exam.tsx
niceeval view --report reports/site.tsx --page exam   # 多页报告，指定初始页
```

位置参数只有一种含义：eval id 前缀，与 `show` 一致。结果根用 `--results <dir>` 传入，单开一份快照用 `--snapshot <file>`——文件与目录都不进位置参数，位置参数的含义不随文件系统状态改变。

本地 server 只监听 `127.0.0.1`。默认让操作系统随机分配端口；`--port <n>` 指定首选端口，被占用时从 n 起向上顺延最多 20 个，全被占用才报错。

裸 `niceeval view` 默认把结果根中的完整 Scope 交给报告；用户直接在页面的组选择器里选择当前可比组，不需要先猜 `--experiment`。`--experiment` 与位置参数只是可选的命令行快捷收窄，对全部页生效——页共享同一份 Scope，内建的 Attempts 页也一样跟随收窄。attempt 详情路由（`#/attempt/@<locator>`）不是页：它对完整结果根解析，被收窄滤掉的 attempt 仍能经深链打开，报告里的证据引用不会因页面过滤而失效。

## 页面构成

- **导航机器：** 页导航、外部链接、语言切换与页脚。导航项只有报告定义声明的页，按声明顺序排列（路由 `#/page/<id>`，`--page <id>` 定初始页）——裸 `view` 的「报告 / Attempts / 追踪」三个 tab 就是[内建报告](library/built-in.md)的三页，宿主不追加、不保留任何导航项。单页定义的唯一页使用缩写展开出的 id `report` 与内置页名「报告 / Report」。浏览器标题按[外壳契约](library/shell.md#行为约束)的回退链取值（报告定义 `title` → 唯一且相同的快照 `name` → 内置文案），是宿主文档单例；页面里的 hero 标题、品牌行、选择警告都不是宿主渲染的——它们是页内的[站点组件](library/site-components.md)。[对象形态的 `defineReport`](library/shell.md) 声明的 `links` 显示在导航右侧（可带内联 SVG 字标 `icon`），`footer`、`head`、`scripts`、`styles` 注入每一页，省略 `footer` 时不渲染页脚。自定义脚本属于增强层：初始静态 HTML 无 JS 完整可读，脚本只添加浏览行为，不改变数据或指标口径。
- **默认报告页（内建首页）：** 页首是 `Hero`（站点标题、最后运行时间、品牌行）、`ScopeWarnings` 与 `CopyFixPrompt`（把当前范围全部失败整理成可交给 coding agent 的修复 prompt），随后 `ExperimentComparison` 接收完整 Scope 并显示全部可比组的索引；选中一组后，只为这一组显示成本 × 端到端成功率散点和 experiment 比较表。切组是纯 UI 状态：不重新扫描结果、不重新计算指标，也不丢掉其它组的数据。可比组由 experiment id 的父目录确定：`compare/bub` 与 `compare/codex` 属于 `compare`，`dev-e2b/bub` 属于 `dev-e2b`，两组绝不共享图、排序或统计；多层 id 使用完整父路径，根目录下的 experiment 各自形成单例组。组卡复用 `ScopeSummary` 的口径，显示组名、experiment / eval 数、端到端成功率、Eval 最终 verdict 构成、成本和最后运行时间；成功率直接渲染 `ScopeSummaryData.endToEndPassRate`，不从 verdict 计数现场重算。无 JS 时每组仍以独立 `<details>` 完整可读，第一组默认展开；渐进增强把它们变成单选组切换，不改变数据。组内比较表由 `ExperimentList` 的 web 面渲染：一行一个 experiment，固定列出实验、模型、Agent、平均耗时、端到端成功率、Tokens、成本和结果摘要；表头可排序，默认按端到端成功率降序，过滤只搜索当前组的 experiment、agent、model、flag 或 eval 文本。端到端成功率把 `failed` 与 `errored` 都记为 0，只有 `skipped` 不进分母；error 仍在结果摘要中单独列出。每行可展开查看该 experiment 的 eval 与 attempt 证据；attempt 行只显示 [Scoring 定义的主失败断言摘要](../scoring/library/display.md#主失败断言怎样选)，passed 行为 `—`，不能罗列全部 matcher。`--report` 用自定义报告文件替换整份页面声明。
- **Attempts 页（内建）：** `Hero` + `ScopeWarnings` + 带过滤的 [`AttemptList`](library/entity-lists.md#attemptlist)，把范围内所有 attempt 展成可筛选列表；页名与全库的 attempt 术语一致。
- **追踪页（内建）：** `Hero` + `ScopeWarnings` + [`TraceWaterfall`](library/site-components.md#tracewaterfall)，用 canonical OTel 字段显示每个 attempt 的执行瀑布行。
- **Attempt 详情（宿主路由 `#/attempt/@<locator>`，对完整结果根解析）：** 判定、断言、统一时间树、结构化错误、按 lifecycle 分组的 diagnostics、usage、对话、trace 和 diff 的入口。判定与断言单点住在源码视图：eval 源码按行叠加断言结果——gate 失败红、没过阈值的 soft 黄、passed 绿、unavailable 灰——失败行展开即是 matcher、expected / received（或 unavailable 的 reason）与 judge 证据，第一条失败行默认展开，整文件级的长值在有界高度内滚动，同一份事实不在页面上出现两次。独立的断言区只在源码不可用（未捕获或 artifact 缺失）时出现，作为同一份事实的 fallback 呈现面：failed / unavailable 与影响判定的 soft 每条一行（断言名、matcher、分数、源码位置），行内一次展开明细，第一条 failed 默认展开；passed 按 group 收进默认折叠区并只显示数量。时间区整体是一个折叠块：收合时只占一行（标题与总耗时），有失败 phase 的 attempt 默认展开，不挤占断言区与源码；展开后以 `result.json.phases` 画主链分解条与收尾段列表，phase 的 children——runner 直接观察到的 hook、沙箱命令和 session/turn——默认收合,按 phase 逐个展开；turn 带 `traceId` 时再从 `trace.json` 挂接 agent/model/tool spans。因而 `sandbox.setup` 能一路展开到某个 hook 里的 `pnpm install`,`agent.setup` 能看到安装 CLI 与写配置的命令,`eval.run` 能从 `s1/t1` 展开到启动 Agent CLI 的命令和轮内 OTel。失败或被超时中断的最深节点带失败标记；并发或嵌套 children 不相加。独立的 Traces 页仍只画被测 agent 的原始 span,runner 节点不写进 trace；Attempt 时间区只是按显式 correlation 组合两类事实。即使 attempt 在 telemetry 建立前失败、没有 trace,错误、diagnostics 与已发生的 phase/hook/command/turn 时间仍从 `result.json` 正常显示。对话面消费[标准事件流](../adapters/architecture/events.md)的完整词汇：源码视图里带 `loc` 的 send 行可展开查看该轮全部回复（assistant 文本、thinking、工具调用、Skill 加载、HITL 请求、错误），`skill.loaded` 以一等条目显示 Skill 名，不伪装成工具调用。轮的归属按 `loc` 判定：带 `loc` 的 user 消息是 runner 记录的 send，开启新的一轮；无 `loc` 的 user 消息属于当前轮——agent 原生 transcript 对同一条 send 的同文本回显不重复显示，轮内注入的 user 消息（stop-hook 反馈、skill 注入等）作为回复条目显示，不会另起一轮把后续回复挂空。事件词汇按条目校验、按条目容错：`events.json` 里前端不认识或形状不合的事件条目以原始 JSON 条目呈现——摘要行显示原始 `type`，展开是完整 JSON——不静默丢弃，也不让整份对话消失；词汇演进（新增事件类型）因此在界面上直接可被发现，后续再补一等呈现。只有非对象条目（没有可展示的结构）丢弃，非数组的 events 载荷整体拒绝。
- **Copy fix prompt：** 全部失败的批量修复 prompt 由内建报告页里的 [`CopyFixPrompt`](library/site-components.md#copyfixprompt) 组件提供；attempt 详情里保留单条失败的复制入口。

## 静态导出

```sh
niceeval view --out site                            # 导出当前结果根
niceeval view --results site-data/run --out site    # 导出 copySnapshots 产出的发布根
```

`--out` 是复印机：把站点产物原样写进一个目录，不设确认关卡——静态站携带的就是结果根里的证据文件，发布给谁、内容是否适合公开，在构建结果根时决定（挑选与瘦身见 [`copySnapshots`](../results/library.md#复制与瘦身copysnapshots)）。输出恒为目录：

```text
site/
├── index.html
├── assets/                  # 外壳 scripts / styles 的 {src} 资产与 head 标签的本地 src/href 资产，按内容哈希命名
└── artifact/
    └── <snapshot-path>/
        ├── sources/
        │   └── <sha256>.json    # 快照级源码去重仓库；attempt 的 sources.json 只是引用，正文在这里
        └── <attempt-path>/
            ├── sources.json     # {path, sha256} 引用列表
            ├── events.json
            ├── trace.json
            └── diff.json        # 根里有才出现；缺时证据位置如实显示缺失
```

源码查看因此自包含：前端按 `sources.json` 的引用 fetch 同快照的 `sources/<sha256>.json` 取正文；携带条目（`artifactBase` 指向原快照）的源码正文由复制管线归拢进本快照的 `sources/`，静态站不需要原快照在场。

多页报告仍导出单个 `index.html`：页面是 `#/page/<id>` 路由，托管方不需要配置多路径。托管路径形态也不设要求：前端 fetch 证据文件时以「页面所在目录」为基底自行解析——pathname 末段带 `.` 视为文件名去掉，否则整个 pathname 就是目录——所以站点根、子目录、直接打开 `index.html`、以及反代 rewrite / cleanUrls 常见的「`<dir>/index.html` 服务在无尾斜杠的 `<dir>` 路径上」都不断链，唯一前提是 `artifact/` 与 `index.html` 保持同级（导出布局本身保证）。`assets/` 只在外壳声明了本地资产（`scripts` / `styles` 的 `{src}`，或 `head` 标签 `attrs` 里的本地 `src` / `href`）时出现；资产按 `assets/<sha256><ext>` 写入并改写 HTML 引用，同内容且同扩展名的资产去重，不受源文件同名影响。`head` 里的外链（`http(s)://`）不进 `assets/`，原样落在标签上由读者浏览器加载。导出的站点会原样携带并在读者浏览器执行这些脚本，发布防呆不检查脚本内容。网页会按需 fetch 证据文件，因此不提供“单个 HTML”导出。

导出没有档位：`view --out` 是复印机，结果根里存在且前端会读取的证据文件——`sources.json` 及其引用的快照级 `sources/<sha256>.json` 正文、`events.json`、`trace.json`、`diff.json`——全部随站复制，缺的在对应证据位置如实显示缺失，不猜也不冒充。体积取舍不在导出层做：要瘦站点，在构建发布根时用 [`copySnapshots({ artifacts })`](../results/library.md#复制与瘦身copysnapshots) 决定带什么（其缺省不带 diff）。唯一永不复制的是 `o11y.json`——报告数字在导出时已烘进 HTML，浏览器不读它，这是「前端读什么带什么」规则的推论，不是一个档位。

**按实验收窄发布 = 换一个根，不是给导出加过滤。** `--out` 与位置参数 / `--experiment` 互斥，同用按用法错误退出：收窄只影响页面统计的 Scope，`artifact/` 证据树与 attempt 详情路由恒随根完整——若允许同用，发布者会以为站点只含该实验，实际根里全部 attempt 的证据都已出站。要发布只含某个实验的站，构建只含它的发布根（`copySnapshots` 收 Scope，`filter` 即收窄），报错文案给出的下一步就是它：

```ts
const results = await openResults(".niceeval");
await copySnapshots(
  results.latest().filter((s) => s.experimentId.startsWith("compare/")),
  "site-data/run",
);
// 然后：niceeval view --results site-data/run --out site
```

「报告聚焦某实验、证据保持全量」是看法层的事，在报告文件里表达——组件 `input` 传收窄后的 Scope，不需要导出参数。

`artifact/` 由与 [`copySnapshots()`](../results/library.md#复制与瘦身copysnapshots) 同一条复制管线产出（同一 50 MiB 预检、同一布局知识）。导出的产物包含**完整的原始证据**——prompt、工具参数、完整输出、源码——深链一点开就是原文。要发布收窄或瘦身过的站，先用 `copySnapshots({ artifacts })` 产出发布根，再对它运行 `view --results <发布根> --out <site>`；运行环境注入的秘密由格式在采集侧挡在结果文件之外（[Results · 复制与瘦身](../results/library.md#复制与瘦身copysnapshots)）。

## 结果版本与错误

扫描整个结果根时，单个不可读快照不会挡住其它结果；每个被跳过的快照形成一条 `unreadable-snapshot` [Scope warning](../results/library.md#警告-kind-全集)（含目录与原因），由页内的 `ScopeWarnings` 组件与其它选择警告一起显示。用 `--snapshot` 明确指定单个快照文件时，该文件不可读会让命令失败。

| 场景 | 行为 |
|---|---|
| 非 niceeval JSON | 忽略 |
| schemaVersion 不兼容 | 跳过并建议用产出它的 niceeval 版本打开 |
| JSON 损坏或必需字段错误 | 标为 malformed |
| attempt 已写入但缺 `snapshot.json` | 标为 incomplete |
| 单个 attempt 缺可选 artifact | 页面可打开，在该证据位置显示缺失 |

零可读结果时，本地 server 不启动，`--out` 也不会生成空站。读取不会迁移或改写历史结果。

## 自定义报告与外壳

```sh
niceeval view --report reports/exam.tsx               # 树形态：报告树替换默认外壳的报告槽
niceeval view --report reports/site.tsx               # 配置对象形态：品牌外壳 + 多页导航
niceeval view --report reports/site.tsx --page exam   # 指定初始页
```

报告文件同时可被 `niceeval show --report` 使用。官方组件都有 web 和 text 两个渲染面，所以同一份报告在浏览器与终端保持相同数据口径；浏览器宿主额外注入 attempt 深链。写法见 [Library](library.md#交给-show--view-渲染)。

`--report` 文件的默认导出恒为 `defineReport` 产物：树形态填报告槽；[配置对象形态](library/shell.md)声明外壳与多页，view 渲染完整导航——报告页按声明序列出，所有页共享同一份收窄后的 Scope，外壳字段（标题、外链、页脚、脚本、样式）只作用于 web 面。`--page <id>` 未命中任何页时按用法错误退出并列出可用页 id。字段穷尽与行为约束见 [Library · 外壳与多页](library/shell.md)。

`ExperimentComparison` 的两个渲染面共享同一份组划分、实体与指标数据，但不强求相同排版：web 面持有全部组并一次聚焦一个可比组；text 面遇到多个组时只输出组索引与可执行的单组查看命令，Scope 已经只有一个组时才输出散点与列表。任何一面都不能把多个组拍平成一张榜单。组内的 `ExperimentList` 在 web 面使用适合人工横向比较的固定列表格，text 面使用适合终端读取的紧凑列表。两面中的端到端成功率、成本、耗时、Tokens、判定构成和证据引用必须来自同一份计算结果。

## 相关阅读

- [Show](show.md) —— 同一批结果的终端入口。
- [Reports Library](library.md) —— 自定义报告槽；外壳与多页见[分篇](library/shell.md)。
- [Results](../results/README.md) —— view 读取与导出的数据。
- [Architecture](architecture.md) —— 报告宿主与「宿主只剩机器」的边界清单。
