# Reports —— 自己搭报告页的积木

这是 `niceeval/report` 的总览:要解决什么问题、两档积木长什么样。API 全貌见 [Library](library.md),边界与决策记录见 [Architecture](architecture.md)。

跑完一轮实验之后,「怎么看结果」不该只有 `niceeval view` 那三个固定 tab。你想把同一批结果摆成一张**考试成绩单**(每个 eval 是一道题,gate 判对错、soft 给分、按科目算总分),摆成一张 **benchmark 榜**(谁写出来的代码能用、谁写得更短、谁更便宜),或者摆成一张**质量 × 成本 frontier**(每个配置一个点,同 agent 不同档位连成线,右上角 = 又好又便宜)——这三种「看法」用的是同一份落盘 artifact,差别只在组合方式。

今天做不到:落盘 artifact 虽然结构化,但没有读取契约,想算个自定义指标只能手工爬目录(那段痛苦的样子见 [Results Lib](../results/library.md) 开头);就算读到了,分组、聚合、null 处理、画图仍是全套手写。

Report 只给**两档积木**,没有中间格式:

```text
 第二档:数据(niceeval/results 读 + niceeval/report 算)  第一档:React 组件(niceeval/report/react,跑在哪都行)
 ---------------------------------------------------    --------------------------------------------------
 .niceeval/<run>/… ──openResults──▶ 实验/结果快照/Selection    <MetricTable/> <MetricScatter/> <DeltaTable/> …共七个
 defineMetric × Dimension                      ──▶  props = 算好的可序列化数据(终值 + 渲染提示)
 MetricTable.data()/MetricScatter.data()… 折出终值    (排序、覆盖率角标、连线、点格子下钻)
 (两级聚合、null 语义、去重全在这侧)
```

- **第一档:React 组件。** 报告页就是你应用里的一页:import 组件,像搭积木一样拼 JSX。组件只认「算好的可序列化数据」,零 IO、可进 `"use client"`,所以 RSC、Vite SPA、静态导出都能用。
- **第二档:parser 与强定义。** `openResults`(来自结果读写库 [Results Lib](../results/library.md) 的读取面)把落盘 artifact 变成「实验 → 快照 → eval → attempt」的类型化数据;`defineMetric` 加挂在组件上的 `data` 计算函数把它折成组件要的数据。组件表达不了的看法,直接拿数据自己算。

两档之间是一条**可序列化边界**:算与画分离,数据是普通 JSON——可以在 RSC 里当场 `await`,也可以在 CI 里落成 `public/report.json` 喂给任何 SPA。**import 边界即运行时边界**:`niceeval/results` 与 `niceeval/report` 的计算函数碰文件系统,只能进服务端/脚本;`niceeval/report/react` 纯渲染。可达百 MB 的 diff 永远不该在渲染路径上被读,这条边界就是为它划的。

## 与现有件的关系

| 件 | 时机 | 职责 |
|---|---|---|
| **Reporter**(`Console()` / `Artifacts()` / `JUnit()`…) | 运行**中**,流式回调 | 把结果送出去:打控制台、落盘、上报平台 |
| **Results Format**(`.niceeval/<run>/`) | 运行**后**,静态 artifact | 唯一持久化事实来源([Results Format](../results/architecture.md)) |
| **Results Lib** | 运行中写,运行后读 | 结果数据的专门库:类型的家 + writer(`Artifacts()` 的落盘实现)+ reader(类型化句柄/快照/选择器)([Results Lib](../results/library.md))。第二档吃它的读取面 |
| **Report** | 运行后,按需 | 指标 × 计算函数 × React 组件,把落盘 artifact 组合成**你自己应用里的报告页** |
| **`niceeval view`** | 运行后,按需 | 内置前端,零代码的通用看法——「报告槽(默认填充 `CostPassRateComparison`,`--report` 整槽替换)+ 证据室」,见 [View · 用 Reports 积木重建 view](../view/architecture.md#用-reports-积木重建-view) |

Report 不新增任何落盘事实——它只消费 Results Format 已有的东西。反过来这也是设计约束:**一个指标能不能算,取决于 artifact 里有没有对应数据**; artifact 缺了(比如 remote agent 没有 `diff.json`),指标对该 attempt 返回 `null`,聚合时跳过,不编数。

> 命名说明:runtime 回调通道叫 **Reporter**,报告库叫 `niceeval/report`。两词同屏的场合只剩 import 语句,混淆面已小;文档里仍永远用全名,不缩写成"报告器/报告"混用。

## 相关阅读

- [Library](library.md) —— React 组件、指标与聚合、计算函数与数据契约、`defineReport` 与双面组件的完整 API。
- [Architecture](architecture.md) —— 边界与不变量、迭代问题裁决记录。
- [Results Lib](../results/library.md) —— 结果读写库:类型的家、writer、`openResults`、实验/快照层次、选择器、身份键;第二档吃它的读取面。
- [Results Format](../results/architecture.md) —— 唯一持久化事实来源。
- [View](../view/README.md) —— 内置前端;报告槽的默认填充是内置 `CostPassRateComparison`。
