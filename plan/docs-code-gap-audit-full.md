# docs/feature + docs/cli.md ↔ 代码 全量差距清单（只找不改）

本文件是一次全量核对的产出：把 `docs/feature/**`（约 70 篇）与 `docs/cli.md` 声明的
**接受的 arg / 数据结构 / 数据建模 / 输入输出 / 语义** 逐条对照 `src/**` 实现，列出所有不相符处。
**只列差距，不含修法**——重构计划由后续 agent 编写。

方法：`docs/source-map.md` 定位落点 → 读源码逐条核对 → 关键 umbrella 断言用 grep 复核。
方向标记：`code-missing`(docs 有 code 无) / `code-extra`(code 有 docs 无) / `contradiction`(直接冲突) /
`shape-mismatch`(形状/类型/命名不同) / `semantics`(名字同、语义/默认不同)。
`[known]` = `docs/source-map.md` 的「已知差异」已登记。

> 注：按 `docs/README.md`，docs 描述的是**目标契约**，允许先于代码；因此绝大多数差距的默认方向是
> 「代码尚未追上 docs」。少数是 code 有而 docs 漏写，或双方真冲突——已逐条标注方向，供计划判断改哪边。

---

## 第一部分：跨多篇文档的根因主题（按影响面排序）

### T1 · 反馈 API：`progress`/`diagnostic`/`ScopedFeedback` 全缺，代码只有 `log(msg)`
docs 在 adapter / eval setup / sandbox hook / 自定义 provider / experiment 五处都注入一个
`ScopedFeedback { progress({message,current?,total?}); diagnostic({code,level,message,data?,dedupeKey?}) }`。
代码里 `ScopedFeedback` 类型不存在（只在 `renderer.ts:54`/`docker.ts:181` 作为未落地的「A2 阶段」注释被提及），
`AgentContext` 与 `TestContext` 都只有 `log(msg: string)`。grep 确认全仓无 `progress(`/`diagnostic(` 签名。

- **数据结构**：`ScopedFeedback` 接口 — 不存在。`AgentContext.log(msg)` `src/agents/types.ts:247`、`TestContext.log(msg)` `src/context/types.ts:280`。
- **DiagnosticInput 形状**：docs `{code,level,message,data?,dedupeKey?}` vs 全仓唯一的 `DiagnosticInput`（run 级、非 adapter 面）`src/runner/feedback/sink.ts:25-35` = `{key,severity,message,identity?,data?}`。shape-mismatch。
- **sandbox hook 上下文**：docs 说 hook 拿「窄上下文」(experimentId+signal+progress/diagnostic)；code 传**完整 AgentContext**（含 model/flags/session/telemetry）`src/runner/attempt.ts:380,350-360`。contradiction。
- **自定义 provider `create`**：docs `create({timeout,runtime,feedback})`；code `create:(opts:{timeout?,runtime?})` `src/sandbox/types.ts:128`、`src/sandbox/resolve.ts:87`、`src/define.ts:147`。code-missing。
- **eval setup 签名**：docs `setup(sandbox, ctx)` 二参带 ctx.progress/diagnostic；code `setup?:(sandbox)=>...` 一参 `src/runner/types.ts:247`，调用点 `src/runner/attempt.ts:392`。shape-mismatch。

涉及 docs：`adapters/architecture/agent-contract.md:50-51`、`adapters/library.md:31,37,41-48,68,72`、`adapters/library/sandbox-agent.md:12,18,35`、`eval/library/context.md:29-47`、`eval/README.md:18,25`、`experiments/library.md:33-64,71-84`、`experiments/cli.md:97`、`sandbox/library.md:146,175-201,243`。
（相关既有计划文件：`plan/exp-output-feedback-models.md`、`plan/attempt-evidence-feedback-loop.md`。）

### T2 · 证据完整性层（coverage / outcome / unavailable / `.optional()`）几乎全缺
docs 的评分架构建立在一个「证据完整性」模型上：Agent 声明覆盖 → 断言可判 partial/unavailable → 判定折叠。
代码用扁平 `passed: boolean`，没有 coverage 通道，没有 `unavailable` 态，没有 `.optional()`。
grep 确认全仓无 `EvidenceCoverage`/`CoverageStatus`/`completeCoverage`；`scoring/types.ts` 无 `outcome`/`unavailable`。

- **EvidenceCoverage 全家桶**：`EvidenceCoverage` 接口 + `CoverageStatus="complete"|"partial"|"unavailable"`（`adapters/architecture/evidence.md:28-43`）、`defineAgent/defineSandboxAgent.coverage` + `completeCoverage` 常量（`evidence.md:48`）、`Agent.coverage`（`agent-contract.md:11,72`）、`Turn.coverage`（`agent-contract.md:31`；`evidence.md:49`）、`result.json.coverage`（`evidence.md:51`；`results/architecture.md:168`）— 全部 code-missing。`SandboxAgentDef`/`RemoteAgentDef` `src/agents/types.ts:286,306` 只有 name/setup/tracing/spanMapper/send/teardown。
- **AssertionResult 判别键**：docs `outcome:"passed"|"failed"|"unavailable"(+reason)`（`scoring/architecture.md:46,58-64`）vs code `passed:boolean` `src/scoring/types.ts:36`。shape-mismatch。
- **失败字段**：docs `expected?`/`received?`（`scoring/architecture.md:52-53`）vs code 只有 `detail?`/`evidence?`。code-missing。
- **`groupPath?:string[]`**（`scoring/architecture.md:34`）vs code `group?:string`（`" › "` join）`src/scoring/types.ts:41`，`collector.ts:54`。shape-mismatch。
- **`optional?:true` 字段 + `.optional()` 链式**（`scoring/architecture.md:37`；`severity-and-verdict.md:31`；`judge.md:43,48`；`value-assertions.md:51,55`；`eval/architecture.md:32`）— ValueAssertion/AssertionHandle/RecordHandle 均无 `src/scoring/types.ts:12-18,47-50`，`collector.ts:30-33`，`expect/index.ts:29-38`。code-missing。
- **判定规则「非 optional unavailable → errored」**（`severity-and-verdict.md:16,31`；`scoring/cli.md:22`）— `src/scoring/verdict.ts:11-19` 无此分支。code-missing。
- **coverage-aware folding**：`ScoringContext` 无 coverage 通道 `src/scoring/types.ts:53-62`；负/上限断言对空/缺证据打 0/1 而非 unavailable（`maxTokens`/`maxCost`/`usedNoTools`/`notCalledTool` `src/scoring/scoped.ts:329-349,171-180,145-154`）（`scoring/architecture/evidence.md:6-9`）。semantics。
- **display 渲染契约**：`expected:`/`received:`/`unavailable/reason:` 行（`scoring/library/display.md:8,110-114`）— 记录形状无此字段，无法填。code-missing。

涉及 docs：`adapters/architecture/evidence.md`、`scoring/architecture.md`、`scoring/architecture/severity-and-verdict.md`、`scoring/architecture/evidence.md`、`scoring/library/{judge,value-assertions,display}.md`、`scoring/cli.md`、`eval/architecture.md`、`results/architecture.md`。
（相关既有计划：`plan/attempt-evidence-feedback-loop.md`。）

### T3 · 结果 schema v6 vs docs v8：整套 v7/v8 形状未落地
`grep` 确认 `src/runner/types.ts:139 export const RESULTS_SCHEMA_VERSION = 6;`，而 `results/architecture.md:42,53` 全篇写 `schemaVersion 8`。docs 把公开数据结构定为**穷尽形状**（未列即不存在），故以下 v7/v8 字段/类型全部构成差距：

- **`DiffData` 形状**：docs `{windows:DiffWindow[]; files:Record<string,DiffFileSummary>; get(path)}`（`results/architecture.md:424-431`）vs code `{generatedFiles:Record<string,string>; deletedFiles:string[]}` `src/scoring/types.ts:69-72`。shape-mismatch（连带 `results/library.md:138-141,148` 的 `attempt.diff()` 例子失效）。
- **窗口化 diff artifact**：`DiffArtifact`/`DiffWindow`/`WindowChange`/`DiffFileSummary`（`results/architecture.md:401-438`）— 全缺；`diff.json` 落的是裸 DiffData `src/results/writer.ts:314`。code-missing。
- **`AttemptRecord.phases?:PhaseTiming[]` + `PhaseTiming`/`TimingNode`/`TimingNodeKind`**（`results/architecture.md:163,228-264`）— `EvalResult` `src/runner/types.ts:82-126` 无 `phases`；三类型全缺。code-missing。
- **`AttemptRecord.coverage`**（`results/architecture.md:168`，见 T2）、**`AttemptRecord.sandbox?:{provider,sandboxId,kept?}`**（`results/architecture.md:184`）— 均缺。code-missing。
- **`AttemptError.phase` / `DiagnosticRecord.phase`**：docs `phase:LifecyclePhase`（`architecture.md:272,282`）vs code `operation:LifecycleOperationName` `src/runner/types.ts:59,76`。shape-mismatch（见 T4）。
- **`ExperimentRunInfo` 重度漂移**（`results/architecture.md:123-138`）：docs `runs:number`/`earlyExit:boolean` 必填、`flags?:Record<string,JsonValue>`、`sandbox?:{provider,params?,fingerprint?}`、+`description?`/`reasoningEffort?`/`maxConcurrency?`/`selectedEvalIds`(必填)/`evalFilterFingerprint?`。code `src/runner/types.ts:15-23`：`runs?`/`earlyExit?` 可选、`sandbox?:string`(!)、缺那 5 个字段、多 `id?`。shape-mismatch + contradiction（sandbox string vs object）。
- **截断子系统**：`StreamEvent`/`TraceSpan` 的 `truncated?`、`Truncation` 类型、`ARTIFACT_VALUE_MAX_BYTES=256KiB`（`results/architecture.md:453,463-472`）— 全缺；writer 裸 `JSON.stringify` `src/results/writer.ts:290-334`。code-missing。
- **`SnapshotMeta.publish?:{redaction:"applied"|"none"}`**（`results/architecture.md:109-110`）— `SnapshotMeta` `src/results/types.ts:30-49` 无。code-missing。

涉及 docs：`results/architecture.md`、`results/library.md`。
（相关既有计划：`plan/sandbox-phase-timing-surfacing.md`（phases）。）

### T4 · 生命周期阶段词表：docs 一套 `LifecyclePhase` vs code 两套枚举
docs 反复声明「展示、envelope 的 `phase=`、落盘 `phases[].name`/`error.phase` 用同一组字符串」，且用点分名
`sandbox.queue`/`sandbox.create`/`workspace.baseline`/`eval.teardown`/`sandbox.suspend`。
code 有两套且成员不同：`AttemptPhase`（11 个连字符名，如 `sandbox-provision`）UI 投影 + `LifecycleOperationName`（14 个点分名，如 `sandbox.provision`/`workspace.prepare`）落盘归属，`src/runner/types.ts:29-46,460-471`（注释明说是两套）。

- envelope `phase=` 打的是 `AttemptPhase` 连字符名（`agent.ts:247`/`ci.ts:247`，`agent.test.ts:178` 断言 `phase=sandbox-provision`），`phase=agent.run`/`sandbox.create` 永不出现（`experiments/cli.md:74,158,228,417-418`）。contradiction。
- 落盘点分名也与 cli.md 阶段表不符：doc `sandbox.queue`/`sandbox.create`/`workspace.baseline`（`experiments/cli.md:78-81`）vs code `sandbox.provision`/`workspace.prepare`，无 queue/create/baseline。contradiction。
- `show` 里 `error.phase` 被 `operationWords` 把 `.`→空格打成 `sandbox provision`，且词表同上不符（`reports/show.md:105,186-231` vs `src/show/render.ts:646-649`）。contradiction。

涉及 docs：`results/architecture.md:207-226`、`experiments/cli.md`、`reports/show.md`。

### T5 · 变更归因：docs 逐 send 窗口分类账 vs code 单次 baseline→final git diff
docs：分类账在沙箱内/workdir 外，`.git` 不在 workdir（agent 看不到、eval 可自行 `git init`），3 个提交点（锚点 + 每次 `t.send()` 的 eval 归因 + agent 归因），agent 归因 = 逐窗口 delta 序列落 `diff.json`；`fileChanged`/`diff.get` 回答「**agent** 在某窗口改了什么」（排除 fixture 与验证写入）。
code：`git init` 就在 workdir 内 `src/runner/sandbox-prep.ts:55`（与 eval 自身 `git init` 冲突），单次 `git add -A && git diff HEAD` `:65`，baseline 一次（`attempt.ts:385`）+ 结束一次（`:459-462`），无逐窗口、无 eval/agent 区分。

- 后果：`fileChanged`/`diff.get` 无法按窗口归因（fixture + post-send 写入都被计入）（`sandbox/architecture.md:32`；`sandbox/library/asserting-results.md:17,21`）。semantics。
- `show --diff` 的逐窗口 patch / 逐 turn 归因 / `+N -M` 计数无法产出（DiffData 是扁平全文；`render.ts:778-808` 只 dump 原文、`M <path> N lines`、注释「A/M 无从区分」）（`reports/show.md:246-266`）。shape-mismatch。
- provisioning 重试只认 rate-limit：`SandboxProvisionErrorKind="rate_limit"|"unknown"` `src/sandbox/errors.ts:8`；无「拒绝类/歧义类」二维分类、无 provision-token 对账、无与文件 IO 共用的兜底分类器（`sandbox/architecture.md:122-133`）。code-missing。

涉及 docs：`sandbox/architecture.md`、`sandbox/library/asserting-results.md`、`reports/show.md`、`results/architecture.md`（DiffData，见 T3）。

### T6 · 沙箱留存 + `niceeval sandbox` 命令 + `--keep-sandbox` + Ref keep/stop 全缺
grep 确认 `src/cli.ts:223` 命令集 = `{exp,show,list,view,clean,init,watch,run}`，无 `sandbox`；全仓无 `keep-sandbox`/`keepSandbox`。

- `niceeval sandbox list/enter/history/diff/stop [--all]` 命令组 + `niceeval exp --keep-sandbox`（`sandbox/cli.md:13,65-70`；`cli.md:33`）— 命令走不到，落到 run 分支报错。code-missing。`[known]`
- 留存注册表 + `commitKeepOrStop()` + `.niceeval/sandboxes/` 逐条目文件 + `sandbox.suspend` 阶段 + 逐 provider suspend + `result.json.sandbox.kept`（`sandbox/architecture.md:52-78`）— `src/sandbox/registry.ts` 只是内存 `Set<Sandbox>`（强清用）；docker 恒 `AutoRemove:true` `src/sandbox/docker.ts:145`。code-missing。
- Effect 层 keep/stop disposition：docs 展示 `Ref.make<"stop"|"keep">` + release 按 mode 决定停不停（`cli.md:137-143`）；code `src/sandbox/resolve.ts:72-83` 无 Ref、release 恒 `stopSandbox`。contradiction。
- timeout 嵌套方向：docs「Scope 外 / timeout 内，超时后 lease 仍活着，同 Scope 内做 teardown+定稿+尝试 keep」（`cli.md:165`）；code `Effect.scoped(...).pipe(Effect.timeoutTo(...))` = timeout 在外、超时即关 Scope 停容器 `src/runner/attempt.ts:123,221-243`（注释自证）。contradiction。

涉及 docs：`sandbox/cli.md`、`sandbox/architecture.md`、`cli.md`。
（相关既有计划：`plan/sandbox-keep-lifecycle.md`。）

### T7 · 原生配置文件特性（`settingsFile`/`configFile`）未落地
grep 确认全仓无 `settingsFile`/`configFile`。

- `claudeCodeAgent({settingsFile})` / `codexAgent({configFile})`（`adapters/library/coding-agent-extensions.md:74-80`；`adapters/architecture/coding-agent-extensions.md:13`；`sdk/claude-code/README.md:21,24,31`；`sdk/codex-cli/README.md:19,22-29`）— `ClaudeCodeConfig` `src/agents/claude-code.ts:40-65`、`CodexConfig` `src/agents/codex.ts:46-64` 均无该字段。code-missing。
- 安装 manifest 记原生配置来源（项目相对路径 + SHA-256）（`.../coding-agent-extensions.md:123`/`:46`）— `AgentSetupManifest` `src/agents/types.ts:59-74` 无此字段。code-missing。
- 安装 checkpoint key 含配置文件字节 SHA（`architecture/coding-agent-extensions.md:38`）— `bubInstallSpec` `src/agents/bub-install-spec.ts:16-24` 无该项；claude/codex 无配置文件级 checkpoint。code-missing。
- marketplace 名回读校验：docs 要求 `add` 后回读注册列表、对不上立刻抛（`architecture/coding-agent-extensions.md:21`）；code `src/agents/claude-code.ts:178-198`、`codex.ts:195-216` add→install 无回读（仅 install 后版本回读）。contradiction。

涉及 docs：`adapters/library/coding-agent-extensions.md`、`adapters/architecture/coding-agent-extensions.md`、`adapters/sdk/claude-code/README.md`、`adapters/sdk/codex-cli/README.md`。

### T8 · 两个完整文档化的 SDK adapter 零代码
grep + 初始文件树确认 `src/agents/langgraph.ts`、`src/agents/openclaw.ts`、`src/o11y/parsers/openclaw.ts` 均不存在。

- `fromLangGraphEvents`（`adapters/sdk/README.md:13`；`adapters/sdk/langgraph/README.md:6` 带 7 点契约）— 全仓无此符号。code-missing。
- `openClawAgent`（`adapters/sdk/README.md:17`；`adapters/sdk/openclaw/README.md:6`）— 全仓无此符号。code-missing。
- `docs/source-map.md:35,36` 指向这两个不存在的文件（本身是 source-map 的错，附录再列）。

涉及 docs：`adapters/sdk/README.md`、`adapters/sdk/langgraph/README.md`、`adapters/sdk/openclaw/README.md`。

### T9 · `--timing` / 阶段时间树在 show/view 未落地（连带 T3 的 `phases`）
- `niceeval show @x --timing` 命令（`reports/show.md:13,97,175-234`）— `ShowFlags` `src/show/index.ts:58-71` 与 `FLAG_OPTIONS` 均无 `timing`（strict 解析直接失败）。code-missing。
- overview `timing:` 阶段摘要行（`reports/show.md:88-89,103`）— 只有 OTel 提示行 `src/show/render.ts:732-733`；无 `phases` 字段。code-missing。
- `available:` 块漏 `--timing`（`reports/show.md:94-98` vs `render.ts:750-754`）。code-missing。
- view attempt 详情 modal 缺「统一时间树 / usage / diff 入口」面板（`reports/view.md:25`）— `src/view/app/components/AttemptModal.tsx:37-91` 只有 verdict/error/diagnostics/CodeView/trace。code-missing。

涉及 docs：`reports/show.md`、`reports/view.md`。
（相关既有计划：`plan/sandbox-phase-timing-surfacing.md`、`plan/show-view-equivalence.md`。）

### T10 · 报告库：内置指标命名/语义 + `config()` 读取器 + ExperimentComparison 形状
- 指标名：docs `taskPassRate`/`executionReliability`/`endToEndPassRate`（`reports/library.md:71,319-321`）；code 只导出 `passRate`/`examScore`/`durationMs`/`tokens`/`costUSD`/`turns` `src/report/index.ts:12`。且 `passRate` 语义（errored 计 0）= docs 的 `endToEndPassRate`，而非 docs 的 `taskPassRate`（errored 记 null 不进分母）`src/report/metrics.ts:48`。code-missing + semantics。
- `config("reasoningEffort",{label})` 维度读取器（`reports/library.md:375,378`）— 全仓无 `config` 符号，只有 `flag()` `src/report/flag.ts`。code-missing。
- `ExperimentComparison`：docs 当成有 `.data()` 的组件 `<ExperimentComparison data={await ExperimentComparison.data(selection)}/>`（`reports/library.md:109,112`）；code 是 `defineReport(...)` 产出的 `ReportDefinition`（无 `.data`）`src/report/built-ins/experiment-comparison.tsx:11`。contradiction/shape-mismatch。
- `AttemptList` `redact` 覆盖面：docs 含 error cause/stack + diagnostic message/data（`reports/library.md:202`）；code `AttemptListItem` `src/report/types.ts:348` 只有 `error?:string`，`compute.ts:270` 只 redact error.message + 断言 detail/evidence。shape-mismatch。

涉及 docs：`reports/library.md`。
（相关既有计划：`plan/built-in-reports-user-parity.md`。）

### T11 · 接收者模型：`t.*` 只读 primary session（docs 说聚合全部 session）
docs 的 headline 接收者模型：`t` = 整个 attempt 全部 session（含 `t.newSession()`）；`session` = 记录断言时快照。
code：`t.*` scoped 只对 `manager.primary.events` 求值 `src/context/context.ts:198-199,267`，runner 甚至构造了全 session 基础 ctx（`attempt.ts:475-479`）却被 handle 丢弃；`session` scoped 在 finalize 时对**活/增长**的 events 求值（非 record-time 快照），只有 `turn` 是真快照 `context.ts:372-383`。

- `t.*` 聚合全部 session（`eval/architecture.md:17`；`eval/library/context.md:60`；`eval/library.md:52`）— contradiction。
- `session` 记录时快照（`eval/architecture.md:18`；`scoring/architecture/scopes.md:8`）— contradiction/semantics。
- newSession 事件「汇入 t.* run 级断言」（`eval/library.md:52`）— 实际永不汇入 primary `src/context/session.ts:162-169`。contradiction。

涉及 docs：`eval/architecture.md`、`eval/library/context.md`、`eval/library.md`、`scoring/architecture/scopes.md`。

### T12 · `earlyExit` / `unstarted` 语义
- docs：`earlyExit` 仅 `passed` 触发；`errored` 不中止其余样本，确定性错误走 run 级 fail-fast（`experiments/README.md:32`；`experiments/architecture.md:31`）。code：`errored` 会 abort 同 key 在飞 + 跳过同 key 未启动 `src/runner/run.ts:512-515,349`，无 run 级 fail-fast。contradiction。
- docs：`unstarted` 吸收 budget + fail-fast + 中断的未派发，使结论落 `incomplete`（`experiments/architecture.md:41`）。code：`unstarted` 只累加 budget-exhausted `src/cli.ts:438-439`；early-exit 折进 `completed` `src/runner/feedback/reducer.ts:114-122`；中断走 `status`。contradiction。（部分连 `[known]` earlyExitUnstarted 恒 0。）

涉及 docs：`experiments/README.md`、`experiments/architecture.md`。

---

## 第二部分：未归入主题的单点差距

### CLI 内部架构（`docs/cli.md`）
- **locator 生成时机**：docs「构造 fresh attempt plan 时即算 locator 并作为身份传进 runAttempt，不是完成后写回」（`cli.md:96-98`）；code 里 pushed `Attempt` 无 locator `src/runner/run.ts:136-143`，`result.locator = locator` 在 run 之后 `run.ts:462-471`（只有 `snapshotStartedAt` 是调度前定的）。contradiction。
- **`reg.required` 语义**：docs「required 决定是否写进 `RunCompletion.reporterErrors` 并让 completion 非 complete」（`cli.md:92`）；code 里所有 reporter-error diagnostic 都进 reporterErrors（不看 required）`src/cli.ts:440-447`，status 也从不看 reporterErrors `src/cli.ts:448`，required 只影响 CI 退出码 `src/runner/feedback/ci.ts:340`。semantics。（与 `[known]` #5 相关但该「非 complete」表述被 code 反驳。）
- **`run`/default 分支**：doc 分派清单（`cli.md:29-37`）漏了默认/`run` 分支与「experiment required」错误路径 `src/cli.ts:223,592-611`。code-extra。
- **`watch`**：doc 说是「一次性动作直接退出」（`cli.md:32`）；code 是未实现 stub，打印「暂未实现(MVP)」`src/cli.ts:532-535`。semantics。
- **`coordinator.stopDynamic()`**：doc 列为 happy-path 独立收尾步（`cli.md:50-51`）；code 正常完成时只在 `finish()` 内部调 `src/cli.ts:802-825`，`coordinator.ts:301`。shape-mismatch（次要）。
- **`.env` / `NICEEVAL_*`**：code 有 `loadDotenv` + `NICEEVAL_RUNS/TIMEOUT/BUDGET/MAX_CONCURRENCY` `src/cli.ts:460,579-583,702`，flag-parsing 节（`cli.md:104-108`）未描述。code-extra（次要）。

### eval / 上下文
- **`defineEval.diff?:{include?,ignore?}`**（`eval/README.md:16,23`）— `EvalDef` `src/runner/types.ts:227-250` 无 `diff` 键。code-missing。
- **`t.send(input)` 结构化消息**（`eval/library.md:27`；`eval/library/context.md:18`）— code `send(text:string)` 只收 string `src/context/types.ts:245`，`session.ts:131-136`。shape-mismatch。
- **`requireInputRequest` filter 字段全集**：doc 说 `{prompt?,action?:string,optionIds?}`（`eval/library/context.md:20`）；code `InputRequestFilter` 还有 `id?`/`display?`/`input?`，且 `action?:string|RegExp`、`optionIds?:readonly string[]` `src/context/types.ts:113-122`。extra-in-code。
- 次要：`TurnHandle.toolCalls` 字段 code-extra（context.md turn 表未列）；`t.sendFile` 实际建 `InputFile{filename,mimeType,dataBase64}` 而非字面 data-URL 字符串（概念表述）。

### experiments
- **`flags` 类型 + parse-time JSON 校验**：doc `Record<string,JsonValue>` + 解析时校验非 JSON 报错（`experiments/README.md:29`）；code `Record<string,unknown>` 无校验 `src/runner/types.ts:281`，`define.ts:61-67`。shape-mismatch + semantics。
- **agent envelope 词表**：doc 闭列含 `kept`（永不发），漏 code 实发的 `budget_exhausted`/`reporter_error`/`interrupted`（`experiments/cli.md:234` vs `agent.ts:119,138,130`）。contradiction。
- **`--model` 拒绝文案** 与实际 i18n 文案不同（`experiments/cli.md:432` vs `src/i18n/zh-CN.ts:97`）。contradiction（仅文案）。
- **覆盖优先级链**：`experiments/library.md:162` 漏了 code 实际生效的 env 层（`src/cli.ts:579-583`，与 `architecture.md:20` 一致）。code-extra（doc 内部不一致）。
- 次要（code-internal）：`src/runner/types.ts:293-296` budget JSDoc「在飞预估」已过时（实际「已完成实测」），会喂进生成的参考页。
- `[known]`：eval 级行 `planned=`/`attempts=`/`rate=`/`reason=early_exit`（`experiments/cli.md:400,406`）无 renderer。

### scoring（未入 T2 的）
- **`eventsSatisfy` 参数序**：doc `(label, predicate)` label 必填（`scoring/library/scoped-assertions.md:71,74`）vs code `(predicate, label?)` 默认 "predicate" `src/context/types.ts:63`，`scoped.ts:269-272`。shape-mismatch。
- **`ToolMatch.input` 类型/注释**：doc 顶层 RegExp + 深度部分匹配（`scoped-assertions.md:46`）；code 类型 `Record<string,unknown>` + JSDoc「浅层包含」`src/context/types.ts:96-97`（运行时 `deepPartial` 其实符合 doc `scoped.ts:28-38`）。shape-mismatch（类型/注释层）。
- **judge 缺 key/model 的行为**：缺 key → `noOpJudge()` 静默不记录 `src/scoring/judge.ts:105-107`（doc 要求记 `outcome:"unavailable"` 且「绝不静默」`scoring/library/judge.md:41`）；缺 model → 调用点 `throw` `judge.ts:131-132`（doc 要求记 unavailable 不崩）。contradiction ×2。

### sandbox（未入 T5/T6 的）
- **`SandboxHook`/`SandboxHookContext` 类型**（`sandbox/library.md:136,141`）不存在；hook 类型是 `AgentSetup`/`AgentTeardown` `src/sandbox/types.ts:89`，且 teardown 不能返回 `Cleanup`（doc 说能）。shape-mismatch。
- **内置 provider 反馈通道**：doc 说自定义 provider 从 `create` 取绑定的 `feedback`（`sandbox/library.md:196`）；code 各 provider 直接调全局 sink `reportActivity`/`reportDiagnostic` `docker.ts:183`/`vercel.ts:125`/`retry.ts:44`。shape-mismatch。（并入 T1 根因。）

### 报告 show/view 输出格式（未入 T4/T9 的）
- **`--out --allow-sensitive-artifacts` 消毒守卫**（`reports/view.md:29-49`）— 无该 flag（strict 解析失败），`buildView` 无条件导出 `src/view/index.ts:84-96`；grep allow-sensitive/redaction/publish = 0。code-missing。
- **`--execution` 无 turn 分段**（`TURN s/t` 头行）（`reports/show.md:145-162`）— 扁平节点列表，无 `turn` kind `src/show/render.ts:572-624,514-564`。code-missing。
- **overview `changes:` 行**：doc `N files changed by agent · M x · A y`（`reports/show.md:91`）vs code `N files changed · M x, M y`（无「by agent」、A→M、逗号分隔）`render.ts:630-638`。contradiction。
- **`--diff` 不可用文案 / 二进制处理**：doc `diff unavailable` + 二进制显字节变化（`reports/show.md:268`）vs code `(no diff recorded... expected: …)`、无二进制路径 `render.ts:774-776`。contradiction。
- **view diagnostics「按 lifecycle 分组」**（`reports/view.md:25`）vs code 扁平 `<ul>` `src/view/app/components/AttemptModal.tsx:122-141`。contradiction。
- **`--execution` 文案细节**：相对偏移无 `+` 前缀（`show.md:155` vs `render.ts:486-487`）；"full agent timing"→"framework timing"（`show.md:169` vs `render.ts:620`）。contradiction（文案）。
- **`--port`** code 收（`src/cli.ts:136-137,493`）但 view.md 未列。code-extra。

### adapters SDK / 采集（未入 T7/T8 的）
- **`fromClaudeSdkMessages` 不发 `thinking`**：doc 说处理 thinking（`sdk/claude-agent-sdk/README.md:6`）；code assistant 分支只 text+tool_use `src/agents/sdk-streams.ts:149-159`（兄弟转换器有发）。code-missing。
- **`fromPiAgentEvents` 无失败态/消息增量**：doc 说处理「失败状态」+ 消息开始/增量（`sdk/pi-agent-core/README.md:3`）；code `PiAgentStream` 无 `failed` 访问器、不发 error、只处理 message_end `src/agents/sdk-streams.ts:217-224,255-291`。code-missing。
- **doc 漏写 code 有的**：`ClaudeCodeConfig.apiKey/baseUrl/maxTurns`（`sdk/claude-code/README.md` 未提）、`CodexConfig.apiKey/baseUrl`（`sdk/codex-cli/README.md` 未提）、`fromChatCompletion`/`fromResponses`（导出于 `src/agents/index.ts:20` 但 `sdk/README.md` 索引无行）。code-extra。

### adapters 采集/streaming 次要
- `streaming.md:32-38` 把「HITL 保存现场」归给 `driveFrameStream`，实际 `src/agents/streaming.ts:66-70` 只返回 waiting Turn，`hold` 由调用方 onFrame 做。semantics（归属表述）。

### results 次要
- `skipped[]` 条目 code 多一个 `detail?` 字段 `src/results/types.ts:158`（`results/library.md:80` 形状未列）。code-extra。
- `results.current({experiments})` / `Selection.attempts` / `Selection.mode` / `copySnapshots.redact` / `PUBLISH_FILE_MAX_BYTES` / 默认排除 diff / `ResultScope` 形状 —— 已并入 T3 附近（`results/library.md`），此处不重复；详见原始 findings。

---

## 第三部分：已在 source-map「已知差异」登记（`[known]`，仍构成 code≠docs，供计划确认改哪边）
- judge 走 OpenAI 兼容 `/chat/completions`，无内置默认模型（解析不到报错）。
- TestContext 用宽接口 + 运行时 capability 守卫，非 TS 条件类型。
- 接收者模型 t/session/turn、会话 API、单一 Verdict、`.atLeast`/`.gate`、无 `defineEval.workspace`、`t.sandbox` 无 `stop()`、无 `t.transcript`、judge 固定 `autoevals.{closedQA,factuality,summarizes}`。
- `RunCompletion.earlyExitUnstarted` 恒 0；agent/ci 的 `planned=`/`attempts=`/`rate=` 未实现。
- `ReporterError.required` 来自当次注册。
- view 是本地 web 查看器；remote defineAgent 支持会话型 eval；文件写/diff/验证仅沙箱型 agent。

## 第四部分：核对为一致（无差距）的区域（供计划排除）
- adapters：README、library/{remote-agent,sessions-and-hitl,writing-an-adapter}、architecture、architecture/{session-state,collection,events}（AgentSession/StreamEvent/InputRequest/deriveRunFacts 逐字段对齐）。
- adapters SDK：ai-sdk、codex-sdk、bub 三篇；reference/* 全部（自述研究笔记，内嵌 niceeval 断言抽查通过）。
- eval：sandbox 操作面（writeFiles/uploadDirectory/readFile/runCommand/runShell/fileChanged/diff.* 及无 stop()）与 judge.autoevals 形状一致。
- scoring：README、library、library/custom-assertions（makeAssertion 字段一致）、reference/provenance；value-matcher 目录 + MatchOptions + similarity 默认一致。
- sandbox：README、library/operations（CommandResult、8 法 IO 重试、commandSucceeded）、library/prebuilt-environments（e2bCodingAgentTemplate、node:24-slim、checkpoints）。
- reports：architecture、README；12 组件 + `.data` 计算名、`MetricCell.refs:AttemptLocator[]` 必填、6 排版原语 + 7 文本工具、`ReportLocale`、渲染入口名。
- results：README（落盘布局 + 命名 API 存在）。
- cli.md：模块地图路径全存在、resolveOutputProfile 顺序、ReporterRegistration 形状、semaphore globalSem/runSem、runPromiseExit+catchAllCause、三级 Ctrl+C+12s 看门狗、show/view 只读隔离。
- view：`#/attempt/@<locator>` 路由、静态导出布局（含/排除的 artifact）、`resolveViewInput` 位置参数。

## 附录：`docs/source-map.md` 自身的落点错误（顺带发现，非 feature/cli 差距）
- `source-map.md:35` 指 `src/agents/langgraph.ts` — 不存在。
- `source-map.md:36` 指 `src/agents/openclaw.ts` + `src/o11y/parsers/openclaw.ts` — 均不存在。
- （`source-map.md:129` 指 `src/report/components.tsx` — 核对为**存在且正确**，非错误。）
