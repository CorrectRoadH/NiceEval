# Feature 文档审查问题

本文件记录 `docs/feature/` 目标契约中的 bug、冲突与不合理设计。严重度表示若照文档实现，对结果正确性或公开 API 的影响。

## 已确认问题

### P1：Turn 重试把“没有采到事件”误当成“请求未被受理”

证据：

- `docs/feature/error-classification/README.md:34-40` 规定只有能证明输入未被 agent 受理时才可重试，因为重复发送可能重复工具调用或污染 workspace。
- `docs/feature/error-classification/architecture.md:85-86` 的实际分类链却只在失败 Turn 已出现 agent 事件时否决重试；事件为空时，限流或网络文本仍可被兜底正则判为可重试。
- `docs/feature/adapters/architecture/evidence.md:21-56` 明确规定事件覆盖可以是 `partial`、`unavailable` 或 unknown，且“没采到”不能证明“没发生”。

因此，事件覆盖不完整的 Adapter 可能已经执行工具或修改 workspace，只是没有采集到对应事件；框架随后原样重发输入，直接污染评测现场。所谓“受理证据门”没有兑现它声称的机器不变量。

建议：事件缺席只有在相关 coverage 为 `complete` 时才能作为未受理证据。coverage 非 complete 时，禁止文本兜底把失败 Turn 升为可重试；只接受能独立证明入场拒绝的协议级分类结果，并明确这份证明如何表达。

### P1：Experiment setup 失败与部分 carry 没有可同时成立的语义

证据：

- `docs/feature/experiments/architecture.md:43` 允许部分 attempt 从缓存 carry，仅在第一个真正需要派发的 attempt 前执行 `setup`。
- 同页 `:47` 又规定 `setup` 抛错后“本实验所有 attempt”都写成 `errored(experiment-setup-failed)`。

例如计划 10 条 attempt，9 条已经 carry，剩余 1 条触发 setup 后失败：保留 9 条原 verdict 就不满足“所有 attempt errored”；覆盖它们会篡改历史事实并破坏 carry 契约；丢弃它们又使最新快照不完整。

建议：明确失败只作用于本次尚待派发的 attempt，已 carry 的终态保持原值；或者显式引入“当前实验水位无效”的实验级状态，而不是伪造每条历史 attempt 都在本次 setup 下执行失败。

### P2：Results reader 的 `Snapshot` 无法读回 writer 写入的完整快照

证据：

- `docs/feature/results/architecture.md:114-115` 把 experiment 级 `facts` 定义在 `SnapshotMeta.facts`。
- 同页 `:383-386` 承诺读取面原样转发，并让 show、对照矩阵与 JSON 呈现这些 facts。
- `docs/feature/results/library.md:165-181` 的公开 `Snapshot` interface 却没有 `facts`。
- 同一个 interface 把 `producer` 写成可选，但 `SnapshotMeta.producer` 在 `docs/feature/results/architecture.md:95-105` 中是可读快照的必填版本元数据。

这破坏了文档声称的“reader 是目录树的类型化投影”，调用方也没有类型安全的入口读取 experiment 级 facts。

建议：在 `Snapshot` 上补齐 `facts`，将 `producer` 改为必填；再逐字段核对 `SnapshotMeta -> Snapshot` 的投影，明确哪些存储字段刻意不暴露以及原因。

### P1：HITL 的 `take()` 在恢复成功前就销毁暂停现场

证据：

- `docs/feature/adapters/architecture/session-state.md:5-21` 定义 `hold()` / `take()`，并明确 `take()` 是一次消费。
- `docs/feature/adapters/library/sessions-and-hitl.md:68-79` 的官方写法先 `take()`，之后才查响应、调用 `resumeNativeRequest()` 并继续消费 cursor。

只要回答缺失、request id 不匹配、`resumeNativeRequest()` 瞬时失败或继续读流失败，暂停现场已经从 session 删除。外层 send 重试再次调用 Adapter 时会走“开始新一轮”分支，无法恢复原审批流，甚至可能重复创建新任务。

建议：把 API 改成事务式 `peek()/commitTake()`，或 `withHeld(state => ...)` 只在回调成功后消费；至少不能让官方推荐写法在第一个可能抛错的 await 之前销毁唯一恢复点。

### P1：Scoreboard 声称支持计分制，但计分制没有可归一化到 `[0, 1]` 的契约

证据：

- `docs/feature/experiments/score-points.md:18-29` 明确规定计分制只累加、没有满分声明，`totalScore` 无上界。
- `docs/feature/reports/library/metric-views.md:208-210` 又要求 `Scoreboard.score` 对每道题必须落在 `[0, 1]`，超出直接报错。
- `docs/feature/reports/use-case/fixed-suite-scorecard.md:9-12` 却指导用户选择“计分制主读数”放进 Scoreboard。

因此通过制可以用 `examScore`，计分制的主读数 `totalScore` 却必然可能超过 1；文档也没有每题满分可供归一化。这条 use case 按当前 API 无法实现。

建议：二选一。要么 Scoreboard 明确只支持 `[0,1]` 指标并删除“计分制主读数”用例；要么计分制声明每题 possible points，并提供官方 normalized score。现在“不声明满分”与“固定满分成绩单”不能同时成立。

### P2：`t` 的读取作用域与断言作用域不同，同一个接收者有两套含义

证据：

- `docs/feature/eval/library/context.md:54-60` 规定 `t.reply` / `t.events` 只看主 session。
- `docs/feature/eval/architecture.md:13-21` 规定 `t.calledTool()` 等 `t.*` 断言聚合全部 session。
- 同页 `:7` 又把“API 无二义、作用域由接收者决定、同一件事不提供两个 API”列为原则。

用户看到 `t.events` 与 `t.event(...)` 会自然认为两者看同一范围，实际前者漏掉 `newSession()`，后者包含它们。并行 session 一加入，手工检查与断言结果就可能互相矛盾。

此外，`t.reply` 与 `turn.message`、`turn.outputEquals(value)` 与 `t.check(turn.data, equals(value))` 都在表达同一事实，直接违反“同一件事不提供两个 API”的自定原则。

建议：把主会话显式建模成 `t.main`，让 `t.main.events/reply/assertions` 同域；attempt 聚合另设 `t.attempt` 或只保留顶层断言。删除 `outputEquals/outputMatches` 这类纯别名，统一走 matcher。

### P2：同一个 `.gate()` 在两种 Eval 中是完全不同的控制流操作

证据：

- `docs/feature/scoring/architecture/severity-and-verdict.md:5-16` 规定通过制 `.gate()` 只改变 severity，不中止执行。
- 同页 `:18-28` 规定计分制 `.gate()` 会就地结束 `test()`。
- `docs/feature/experiments/score-points.md:48-49` 甚至规定它写不写 `await` 都可能在“下一次任意 `t.*` 调用或 test 返回”时才抛中止信号。

相同拼写在一个类型里是声明式严重度，在另一个类型里是延迟抛出的控制流；代码从 `defineEval` 改成 `defineScoreEval` 后，原有 `.gate()` 会悄悄从“继续收集诊断”变成“截断后续代码”。`await` 看起来有语义，文档又说没有，进一步制造错误心智。

`.atLeast(1)` 也同时承担“soft 分数阈值”，而 `calledTool(..., { count })` 才是次数；文档在多处反复警告“不是至少调用一次”，说明命名已经持续诱发误读。

建议：控制流使用独立动词，例如 `require()` / `stopUnless()`；severity 保持 `.gate()`。soft 阈值使用 `.threshold(x)` 或 `.soft({ threshold })`，不要让 `.atLeast` 与数量条件争夺直觉语义。

### P2：数据集不是“一般代码”，而是没有名字、无法承载组元数据的隐式协议

证据：

- `docs/feature/eval/architecture.md:7-9` 声称数据集不是一等概念，没有约定式黑箱。
- `docs/feature/eval/library.md:43-50` 实际让模块默认导出在 `EvalDef`、`EvalDef[]`、`Record<string, EvalDef>` 三种形状间触发不同发现和 id 生成规则。
- `docs/feature/eval/README.md:25` 与 `use-case/dataset-fanout.md:79-80` 又声称整组条目共享 `tags` / `environment`，但数组和 record 外面没有任何组对象可以声明这两个字段；每个 `EvalDef` 自己反而都有这些字段。

这是一个事实上的 Dataset DSL，只是拒绝给它命名。结果是 discovery 靠默认导出形状猜语义，组级配置却无处可写，文档中的“整组共享”无法由类型表达。

建议：引入显式 `defineDataset({ cases, tags, environment, define })`，或者承认元数据逐 Eval 定义并删除“整组共享”契约。显式原语比魔法 default export 更符合“无二义”。

### P2：局部选择后的用例错误要求用户全量重跑

`docs/feature/experiments/use-case/eval-selection.md:33-41` 说带 eval 前缀跑出部分快照后，“对照报表要用不带位置参数的完整重跑”。这与 Results/Runner 的核心设计相反：fingerprint carry 负责把终态带进新快照，`results.current()` 负责从可比快照补齐当前水位，覆盖缺口也有明确占位。

这条建议会让用户无端重付整套 eval 成本，也掩盖了真正需要全量重跑的条件：配置改变导致旧快照不可比、使用 `--force`、或历史题本来没有可信终态。

建议：改成先用默认 `current()`/carry 查看；只有 `coverage.missingEvalIds` 非空且原因是不可比或无历史结果时才补跑缺项。用例必须给出如何判断，而不是一律全量重跑。

### P2：Report `extends` 只能换外壳，改一页就要求照抄整站

证据：

- `docs/feature/reports/library/shell.md:201-204` 规定 `extends` 完整继承 base pages，只能整字段覆盖外壳；任何 page 修改都必须重新声明全部 pages。
- `docs/feature/reports/library/built-in.md:81-86` 明确给出的两条路就是“整站引用”或“全文照抄”，修改 attempt page 也要复制完整页面列表。

这不是可组合的继承，而是主题/站点元数据覆盖借用了 `extends` 的名字。最常见的“保留标准报告，只加一页 / 换一页”反而没有 API，用户必须复制内建定义，随后与新版内建页面永久漂移。

建议：提供稳定的页面组合操作，例如 `extendReport(standard, { addPages, replacePages, removePages, shell })`，或让 `standard.pages` 成为可组合数据并提供按 id 的不可变变换。仅换外壳的能力应直接叫 `withShell`，不要冒充继承。

### P3：部分 `use-case/` 不是用例，而是重复 reference 或组件选型便签

两种典型：

- `docs/feature/eval/use-case/calledtool.md:1-7` 明说要遍历“每个字段每种形态”，并把自己当“行为核对清单”；它是第二份 API reference，与 `scoped-assertions.md` 重复，不是一个用户目标的端到端流程。
- `docs/feature/reports/use-case/compare-quality-cost.md` 等大量报告用例只有约 17-20 行，所谓“全流程”只是依次点名 `ExperimentComparison -> MetricScatter -> MetricTable -> locator`，没有输入数据、可运行代码、预期输出或失败分支。真正代码又被推到 recipes，用户必须在三层文档之间来回跳。

这违反 `docs/feature/README.md` 对 use case 的定义：一篇应讲一个问题从调用到结束反馈的完整路径，而且不复制契约定义。

建议：

- `calledtool.md` 移回 Library reference 或删掉，只保留 2-3 个真实过程审计场景。
- 报告用例与 recipes 合并：每篇至少给最小可运行报告、所需 Scope、预期 text/web 结果、缺数据行为和下钻路径。
- `concurrency.md` 这类 9 场景速查拆成决策表加少数完整用例，避免一篇同时承担教程、reference 和故障手册。

### P1：强杀恢复登记没有资源身份，且在清理成功前删除唯一义务记录

证据：

- `docs/feature/experiments/architecture.md:58` 的登记只有 `{ experimentId, selectedEvalIds, pid, host, startedAt }`，没有 setup 创建出的 tunnel/container/license id。
- 同页 `:60` 承认新进程的模块闭包已经丢失，要求 teardown 自己从其它持久化找回资源。
- `docs/feature/experiments/library.md:133-147` 的主推荐写法却只把资源句柄放在模块闭包，teardown 是 `tunnel?.stop()`；新进程执行时它必然是 no-op。
- `docs/feature/experiments/architecture.md:61-62` 在真正执行 teardown 之前先删除登记，失败后也不恢复。

因此所谓“启动自愈”默认只能调用一个拿不到旧资源的函数。除非用户额外发明第二套 pid 文件或外部命名协议，框架登记本身无法完成清理；一旦恢复 teardown 抛错或新进程再次崩溃，唯一记录还已经消失，违反“磁盘存在登记当且仅当收尾义务未完成”的不变量。

建议：让 setup 返回可序列化的 cleanup descriptor，由框架原子写入登记，teardown/recover 接收它；登记在清理确认成功后才删除。并发抢占应靠 lease/rename 到 in-progress 状态，而不是先删除义务记录。无法序列化清理身份的 hook 应明确标为不支持跨进程恢复，不能承诺自愈。

### P2：Experiment 参数扫描靠复制文件，报告却把参数扫描当一等用例

证据：

- `docs/feature/experiments/library.md:421-448` 强制“一文件一配置”，明确要求扫多个 agent/model 时复制实验文件。
- `docs/feature/reports/use-case/sweep-parameter-trend.md:5-12` 又把多档参数扫描和 `MetricLine` 作为正式用例。

一个 5 model × 4 context 档位的扫描需要 20 份几乎相同的文件；共享字段修改必须同步 20 次，所谓“可 diff、可 review”实际制造的是重复和漂移。更糟的是参数轴本来已经通过 `flags` / `labels` 结构化存在，authoring 端却没有与报告端对称的矩阵生成原语。

建议：允许实验模块显式导出 keyed matrix，例如 `defineExperimentMatrix({ axes, base, build })`，每个展开项仍有稳定 id、独立 fingerprint 和可单跑路径。重点是显式、可审计的生成，不是让 `model` 字段直接接受数组。

### P2：失败分类声称两轴正交，API 却要求一个分类器同时裁决两轴

证据：

- `docs/feature/error-classification/architecture.md:17-24` 把 `retryable` 与 `scope` 称为两条正交轴，但 `FailureClass` 强制每个结果都填写 `retryable`。
- 同页 `:78-85` 使用整对象 first-wins；实验分类器为了提供 scope 排在 adapter 前面，因而同时屏蔽 adapter 对 retryable 的协议知识。

实验作者可能知道“这个 host 属于全实验”，却不知道协议是否在受理前拒绝；Adapter 恰好知道能否安全重试，却不知道该 host 的业务作用域。当前 API 强迫前者猜 `retryable`，或放弃声明 scope。文档示例直接猜成 `false`，把正交信息损失固化为推荐写法。

建议：分类器返回可缺省的 axis patch，例如 `{ scope?; retryable?; reason? }`，两条轴分别按自己的优先级链解析；实验知识填 scope，Adapter/受理门填 retryable。最终消费前再补默认值，而不是第一份部分知识独占整个分类结果。

### P2：错误分类文档的 `defineExperiment` 示例使用了被禁止的 `id`

`docs/feature/error-classification/library.md:22-23`、`:53-54` 与 `use-case/write-a-classifier.md:31-32` 都写：

```ts
defineExperiment({ id: "codex-nowledge", ... })
```

但 `docs/feature/experiments/README.md` 和 Library 明确规定 experiment id 只能从文件路径推导，公开形状没有 `id`，并禁止手写。按目标类型实现后，这三段官方示例都不能通过 TypeScript。

建议：删除 `id`，在代码块注释里用文件路径说明推导出的 experiment id。把“文档代码块可类型检查”加入 docs 守护，否则跨 Feature 示例会继续漂移。
