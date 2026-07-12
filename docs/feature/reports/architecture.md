# Reports —— 架构

`niceeval/report` 的边界与不变量,以及设计迭代中裁决过的问题记录。使用侧 API 见 [Library](library.md);整体动机见 [README](README.md)。

## 边界与不变量

- **core 中立不破。** 指标函数是用户代码,想读什么 artifact 读什么;但计算函数与组件只认 `Metric` / `Dimension` 接口,不出现 `agent === "codex"` 这类分支。「考试」「benchmark」「frontier」都不是 core 概念,只是积木摆法。
- **Report 不写事实。** 唯一事实来源仍是 Results Format;组件数据是派生物,删了随时可重算,因此不需要迁移机制。
- **null ≠ 0。** `null` = 此 attempt 测不了这个指标,不进聚合;`0` = 测了,结果是零,照常进。每个指标(含内置)对四个 verdict 逐一表态;`MetricCell` 用 `samples` / `total` 如实报覆盖率,一组全 `null` 渲染成缺数据,绝不补 0(与[成本设计](../../observability.md#换算成本价格表从哪来)「未知模型不瞎猜」同一原则)。scoreboard 的固定分母是显式的考试契约、不是这条的例外:没答的题 0 分挣,`missing` 如实报。
- **报告不重新判卷。** 指标只消费落盘的 `verdict` 与断言,不推翻 run 时的判定口径;换口径的正确位置是重跑,不是报告。
- **选择诚实。** 残缺快照、被跳过的 run、发生过的去重,全部以 `warnings` / `skipped` 返回给调用方,不静默;组件对 `samples < total`、全 `null` 的格子和缺数据的点如实渲染。宿主渲染入口(`renderReportToText` / `renderReportToStaticHtml`)另在报告输出前统一渲染 `selection.warnings` 横幅(见 [Library · 宿主级警告横幅](library.md#宿主级警告横幅)),任何报告——无论它的树里含不含 `RunOverview`——都不会静默吞掉挑选警告。
- **跨快照聚合先去重。** 计算函数在聚合前按 [Results Lib 的身份键](../results/library.md#身份键与去重)去重——`--resume` 会让同一 attempt 存在于多份落盘,细节与键的定义见那边。
- **快照身份保留在结果库。** 合并与聚合永远发生在计算函数里,可被用户的选择与聚合配置覆盖。
- **数据 ↔ 两面成对。** 每种数据产物必须同时有 web 面与 text 面——`defineComponent` 的 `faces` 两键必填,配对是结构义务而非配对表;双面验收测试守护两面判读一致。缺一面就不能发新组件(否则 `--report` 在两个宿主下不对称)。

## 迭代问题裁决记录

早先挂在这里的「待定 DX 问题」已全部裁决(2026-07-10),每条记决定与理由:

1. **时间轴 delta:不做新组件,`DeltaTable` 收快照键。** `pairs` 的 `a` / `b` 除 experiment id 外也收快照键 `<experimentId> @ <startedAt>`(与 `"snapshot"` 维度同一格式)。时间轴对比本来就要旧快照,`latest()` 里没有——配手挑的 `Snapshot[]`(如 `[exp.latest, exp.snapshots[1]]`)按快照键配对。view 的 Compare 落地时对齐这同一个键,两套「对比」语义不分叉。
2. **`refs` 完整携带,不设上限。** 「每个数字点进去就是证据」不打折;单格样本数有限,全历史矩阵的规模由消费方用 Selection 控制,不由组件截断。
3. **组件数据不打版本戳。** 同应用内计算与渲染同包同版本,天然无偏斜;分离部署(CI 算数据、另一仓库渲染)把两侧锁在同一 niceeval 版本是**硬要求**,不是建议——版本戳解决不了偏斜,只能把它报出来,锁版本让它不发生。
4. **官方组件不开 slots / render props。** 样式面只有三样:稳定 `nre-*` 类名、`className` 透传、`<Style>`。半自定义的正确姿势是 `defineComponent` 整个换——在官方组件上开渲染口子就是造中间层,格子渲染、点标签策略这类需求都归自定义组件。
5. **view 的 attempt 级深链:改判给 `AttemptLocator`。** 随 `AttemptLocator` 重设计改判为不透明的 `#/attempt/@<locator>` 单段路由(见 [View · 用 Reports 积木重建 view](../view/architecture.md#用-reports-积木重建-view))。「报告页是前门、view 是证据室」的分工闭环不变,变的只是深链参数的编码。
6. **`view --report` 的装载语义。** dev server 模式:报告文件变更**整页重算**,不做细粒度热重载——计算全部住在报告函数体里,整页重算是唯一与这条边界一致的语义。`--out` 模式:报告树在计算侧 `renderToStaticMarkup` 成 HTML 烘进报告槽,证据室沿用 `__NICEEVAL_VIEW_DATA__` 的数据契约不动。两个宿主共用同一套装载语义,实现顺序(show 先行)不影响这两条。
7. **`missing-startedAt` 不透出到组件数据。** `writer.snapshot()` 的 `startedAt` 必填,官方产出与走写入面的第三方转换永不缺;缺失只可能来自 legacy 落盘,计算函数「不去重、如实保留重复」的兜底即终稿,不给各 `data` 产物加 warnings 通道(`dedupeAttempts` 直调时警告仍随返回值走)。

## 相关阅读

- [README](README.md) —— 为什么需要 Report、两档积木的取舍。
- [Library](library.md) —— React 组件、计算函数、数据契约、`defineReport` 与双面组件的完整 API。
- [Results Lib](../results/library.md) —— 身份键与去重、`--resume` 下同一 attempt 的多份落盘。
- [Observability](../../observability.md) —— 成本设计:未知模型不瞎猜,与「null ≠ 0」同一原则。
- [View](../view/architecture.md) —— attempt 级深链改判 `AttemptLocator` 的实现细节。
