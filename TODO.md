# TODO:docs/ 重构落地为代码变更

这份清单是**代码变更计划**,不是审计报告。全部差异已经拍板完,分四类:

- **代码变更计划(A-F)** —— 判成「文档为准」的项,写清要动哪个文件、加/删什么,照着做就行。
- **文档修正** —— 判成「代码为准」的项,已经直接改完文档。
- **已决定维持现状** —— 判成"两边都别动"的项。
- **建议的处理顺序** —— 怎么排期。

---

## 代码变更计划(已拍板,等实现)

### A. `t` / `session` / `turn` 接收者模型 —— `src/context/context.ts`、`src/context/session.ts`、`src/types.ts`

- [ ] **A1. `session` 收窄成真正受限的 `SessionHandle`**,不再是完整 `TestContext` 克隆。
  - `src/types.ts`:新增 `SessionHandle` 类型,只含:驱动 API(`send`/`sendFile`/`requireInputRequest`/`respond`/`respondAll`,没有 `newSession`)、结果读取字段(`reply`/`sessionId`/`events`)、作用域断言(`succeeded`/`calledTool`/`event`/... 同 `t`)、`session.judge`。不含 `check`/`require`/`sandbox`。`TestContext.newSession(): SessionHandle`。
  - `src/context/context.ts`:`newSession()` 不能再直接复用 `makeContext(...)` 的完整结果,要单独组一个只含上述字段的对象。
- [ ] **A2. 给 `turn` 补上完整作用域断言词汇**(`succeeded`/`calledTool`/`notCalledTool`/`toolOrder`/`usedNoTools`/`maxToolCalls`/`event`/`calledSubagent`/`eventOrder`/`eventsSatisfy`/... 与 `t`/`session` 同一套实现,只是数据源收窄成这一轮自己的事件)。
  - `src/scoring/scoped.ts`:确认现有实现能接受"单轮事件切片"作为数据源(目前应该是按 run/session 级事件设计的,需要看能不能直接复用同一套函数只换输入)。补上 `calledSubagent`/`eventOrder`/`eventsSatisfy` 这三个目前 `t`/`session`/`turn` 都没有的作用域断言。
  - `src/types.ts` + `src/context/context.ts`:`TurnHandle` 加方法签名 + `toolCalls` 字段,`makeTurnHandle` 里用 `turn.events` 当数据源挂上去。
- [ ] **A3. 实现 `requireInputRequest` / `respond` / `respondAll`**(人机交互式 agent 场景:agent 请求输入 → 断言恰好一个待处理请求 → 回答)。
  - `src/types.ts`:`TestContext`(和 A1 的 `SessionHandle`)加这三个方法签名。
  - `src/context/context.ts` + `src/context/session.ts`:实现 `requireInputRequest(filter?)`(gate,按工具名/action input/prompt/display/option ids 匹配)、`respond(...responses)`、`respondAll(optionId)`。
  - ⚠️ **先确认这个:** 目前 `claude-code`/`codex`/`bub` 三个 adapter 的 transcript 解析器里有没有"待处理输入请求"这个概念对应的事件类型。如果没有,这条的工作量不是加三个方法,而是要先在 o11y 事件模型里定义这个概念,量级会比其它几条大一截,建议实现前单独确认。
- [ ] **A4. 补上 `t.sessionId` 和顶层 `t.events`**(现在事件只能从 `t.transcript.events()` 拿)。
  - `src/types.ts`:`TestContext` 加 `sessionId`、`events` 字段。
  - `src/context/context.ts`:`makeContext` 里挂上这两个 getter,数据源是主 session。
- [ ] **A5. 删掉 `t.transcript` 命名空间**(`.compactions()`/`.events()`/`.text()`),改成显式 `{ on }`。
  - `src/types.ts`:删 `TranscriptNamespace`、`TestContext.transcript`。
  - `src/context/context.ts`:删对应实现。
  - ⚠️ **先确认这个:** `{ on }` 现在能不能表达 `.compactions()`(压缩次数)、`.text()`(整段 transcript 文本)原来能表达的场景。如果不能,要先给 `{ on }` 的材料构造补上等价能力,再删 `transcript`,不然是纯减法,功能会倒退。
  - 顺手清 i18n 字符串(`src/i18n/{en,zh-CN}.ts`)和内部示例里的 `t.transcript` 用法。
- [ ] **A6. 补上 `turn.judge`**,默认材料 `turn.message`。
  - `src/types.ts`:`TurnHandle` 加 `judge` 字段。
  - `src/context/context.ts`:`makeTurnHandle` 里用现有 `buildJudge(...)` 挂上,默认材料传 `turn.message`(复用 A2 时如果已经在做 `TurnHandle` 的改动,建议合并一次做)。
- [ ] **A7. `t.judge` / `session.judge` 默认材料从"最后一条消息"改成"整段对话"**(和 `turn.judge` 的单轮默认区分开)。
  - `src/scoring/judge.ts`:`buildJudge` 目前默认材料来自 `RunSession.lastMessage`,需要改成拼出该 session 到当前为止的完整对话文本。
  - ⚠️ **先确认这个:** `RunSession` 现在是否已经保存了每一轮的历史消息,还是只存了 `lastMessage`。如果只存了最后一条,这条要先给 `RunSession` 补历史累积,再改 judge 的默认材料构造。

> A1/A2/A3/A6 都在动 `TurnHandle`/`SessionHandle`/`TestContext` 这几个类型,建议合并成一个 PR 一次改完,避免中间态互相打架。

### B. 生命周期钩子删除 —— `src/types.ts`、`src/runner/run.ts`、`src/index.ts`

- [ ] **B1.** `src/types.ts`:删 `RunContext`(含 `share()`)、`LifecycleHooks`、`Config.hooks`、`ExperimentDef.hooks`、`AgentContext.shared`、`TestContext.shared`。
- [ ] **B2.** `src/runner/run.ts`:删 `setupRunHooks`(约 63-347 行)及 run 级/sandbox 级 setup/teardown 的调用点(约 583-594 行),删掉引用已不存在的 `docs/lifecycle.md` 的注释(约 167 行)。
- [ ] **B3.** `src/index.ts`:删 `LifecycleHooks`/`RunContext` 导出。
- [ ] **B4.** 搜一遍 `examples/`、`docs-site/` 里是否有示例用到 `hooks`/`ctx.shared`/`run.share`,同步清理。

### C. 断言链式 API 与 Verdict/Outcome/Judge —— `src/scoring/*`、`src/expect/index.ts`、`src/types.ts`

- [ ] **C1. 合并 `Verdict`/`Outcome`,只保留 `Outcome`**(四态 `passed`/`failed`/`errored`/`skipped`,无 `scored`)。
  - `src/types.ts`:删 `Verdict` 类型和 `EvalResult.verdict` 字段。
  - `src/scoring/verdict.ts`:删 `computeVerdict()`,只保留(或重命名收口)`computeOutcome()`。
  - 搜一遍 `src/runner/reporters/{console,json,index}.ts` 里所有读 `.verdict` 的地方改成读 `.outcome`。
- [ ] **C2. 删掉 `.soft()`**,链式断言只保留 `.atLeast(x)` / `.gate(x?)`。
  - `src/types.ts`:`AssertionHandle`/`ValueAssertion` 删 `soft(threshold?)` 签名。
  - `src/scoring/collector.ts`:`RecordHandle` 删 `soft()` 实现。
  - 搜一遍 `src/`、`examples/` 里是否有代码调用 `.soft()`,同步改成 `.atLeast()`。
- [ ] **C3. 给 `.gate()` 补上可选 threshold 参数**(`.gate(0.8)` 这种带硬阈值的用法现在不生效)。
  - `src/expect/index.ts:30`:`gate` 不再固定丢弃 threshold。
  - `src/scoring/collector.ts:66-70`:`.gate(x?)` 传了就设 `spec.threshold = x`,不传保持现在"任意 >0 分过"的行为。
- [ ] **C4. 删掉 `scriptPassed`/`testsPassed`,实现 `commandSucceeded` matcher**。
  - `src/expect/index.ts`:新增 `commandSucceeded()`,判 `CommandResult.exitCode === 0`。
  - `src/scoring/scoped.ts`、`src/context/context.ts:179-186`:删 `scriptPassed`/`testsPassed` 实现。
  - `src/i18n/{en,zh-CN}.ts`:清对应字符串。
  - **这条解锁 `getting-started.md`/根 `README.md` 示例可编译性的一半问题**(另一半等 D5 的 `writeFiles`/`uploadFiles` 签名)。
  - `runCommand`/`runShell` 是否合并成一个 `run()`:**先不动,留到最后单独决定**(见文末备注)。
- [ ] **C5. 删掉 `t.judge.agent` / `t.judge.score`**,judge 收窄成只有 `autoevals.{closedQA,factuality,summarizes}`。
  - `src/types.ts:766-774`:`JudgeNamespace` 删 `agent`/`score` 签名。
  - `src/scoring/judge.ts:271-280`:删对应实现和开放式 `SYSTEM_PROMPT`(确认没有其它地方复用这个 prompt 再删)。
- [ ] **C6. 把 diff 断言挪进 `t.sandbox.diff` 命名空间**(现在是顶层 `t.diff`)。
  - `src/types.ts:847`:把 `readonly diff: DiffView` 从 `TestContext` 挪到 `Sandbox`(或 `t.sandbox` 对应的受限接口)上。
  - `src/context/context.ts:164`:挂载点跟着挪。
  - 搜一遍现有代码/示例里 `t.diff.get(...)` 的调用点改成 `t.sandbox.diff.get(...)`。

### D. Sandbox 文件 IO 与受限接口 —— `src/types.ts`、`src/sandbox/*`、`src/runner/run.ts`、`src/define.ts`、`src/context/context.ts`

- [ ] **D1. 删除 `defineEval.workspace` 字段和固定自动上传编排**,起始文件改成 `test()` 里手工调用。
  - `src/types.ts`:删 `EvalDef.workspace`/`Config.workspace`。
  - `src/runner/run.ts`:删 `resolveWorkspace` + `collectWorkspaceFiles` 自动上传那段固定编排(在 `initGitAndCommit` 之前)。
  - 现有依赖 `workspace` 字段的 eval/examples 改成在 `test()` 开头手工调 `t.sandbox.uploadFiles`/`uploadDirectory`。
- [ ] **D2. 给 `t.sandbox` 拆出受限的 author-facing 接口,去掉 `stop()`**(与 A1 的 `SessionHandle` 同一种"拆受限视图"模式)。
  - `src/types.ts`:新增受限类型(不含 `stop()`);`TestContext.sandbox` 类型改成这个受限类型;后端内部仍用完整 `Sandbox` 接口(带 `stop()`,由 runner 生命周期调用)。
  - `src/context/context.ts`:`t.sandbox` 挂载点换成受限类型包装。
- [ ] **D3. 删除 `setWorkingDirectory`/`getWorkingDirectory`**(和文档"不提供可变 cwd,只能按命令传 `cwd`"对齐)。
  - `src/types.ts`:删 `Sandbox.getWorkingDirectory()`/`setWorkingDirectory()`。
  - `src/sandbox/{docker,e2b,vercel}.ts`:删对应实现。
  - 确认没有内部代码(runner/agents)依赖可变 cwd,全部改成显式传 `{ cwd }` 给 `runCommand`/`runShell`。
- [ ] **D4. 实现 `uploadDirectory`**(docker/e2b/vercel 三个后端)。
  - `src/types.ts`:`Sandbox` 加 `uploadDirectory(localDir, targetDir, opts?)`。
  - 三个后端分别实现:递归读本地目录 → 打包/逐文件上传到沙箱指定路径。
- [ ] **D5. 给 `writeFiles`/`uploadFiles` 加 `targetDir` 参数**。
  - `src/types.ts`:`writeFiles(files, targetDir?)`/`uploadFiles(files, targetDir?)`。
  - 三个后端跟着改签名实现。
  - **这条 + C4(`commandSucceeded`)一起解锁 `getting-started.md`/根 `README.md` 示例的可编译性,改完顺手跑一遍确认真的能编译。**

### E. Runner 行为 —— `src/runner/run.ts`、`src/cli.ts`、`src/scoring/verdict.ts`

- [ ] **E1. 指纹缓存**:对`(eval 代码 + 解析后的 config)`做内容哈希,内容不变且上次 `passed` 才跳过;不匹配就重跑。现有 `--fresh` flag 改名成 `--force`,和文档对齐。
  - `src/runner/run.ts`:现在按 `(experimentId, evalId)` key 搬运上次结果那段逻辑,加上内容哈希比较。
  - `src/cli.ts`:`--fresh` → `--force`。
- [ ] **E2. 实现 budget 护栏**:调度器里累计已花费成本,超过 experiment/run 级 `budget` 就停止派发新 attempt,报告 `run:budgetExceeded`。加 `--budget` CLI flag。
- [ ] **E3. 把 `Reporter` 扩展成分阶段事件流**(`run:start`/`eval:start`/`eval:complete`/`run:earlyExit`/`run:budgetExceeded`/`run:saved`/`run:summary`),替代现在的 3 方法接口 —— 已确认有下游消费方(实时进度条/第三方 dashboard 类)需要更细粒度。
- [ ] **E4. 实现 `--strict`**:`src/cli.ts` 加 flag,`src/scoring/verdict.ts` 的 `computeOutcome` 加 strict 开关,开了让 soft 断言失败也导致 `outcome=failed`。
- [ ] **E5. 实现 `fasteval init`**:生成 `evals/` 目录 + `fasteval.config.ts` 起始文件,和 `getting-started.md` 第一步对齐。
- [ ] **E6. 实现 `--tag`**(按 `EvalDef.tags` 筛选 discover 出来的 eval 列表)**和 `--junit <path>`**(接现有 `JUnit()` reporter,`src/runner/reporters/json.ts`)。

### F. Agent 能力模型 —— `src/types.ts`、`src/runner/run.ts`、`src/define.ts`

- [ ] **F1. 删除 `Agent.kind`,改成 `AgentCapabilities.sandbox?: boolean`**(`kind` 唯一的理论优势——编译期 narrowing——现有代码没用上,`ctx.sandbox` 已经是无条件 required 类型)。
  - `src/types.ts`:删 `kind` 字段;`AgentCapabilities` 加 `sandbox?: boolean`。
  - `src/runner/run.ts`:所有 `run.agent.kind === "sandbox"`/`"remote"` 判断改成 `run.agent.capabilities.sandbox`。
  - `src/define.ts`:`defineSandboxAgent`/`defineAgent` 两个构造函数不变,只是产出的 `capabilities.sandbox` 值不同(`true`/`false`),不再靠 `kind` 字段不同。
- [x] **F2. 删除 `src/agents/registry.ts` 死代码**(`Config.agents` 命名注册表这个产品形态不做,当前定位就是一个 config 对应一个 agent)。已删,顺手清了 `docs/source-map.md:22` 里指向它的那一行。

---

## 文档修正(已直接改完)

- [x] `docs/runner.md` 删掉「重试:压平基础设施抖动」整段,以及正文里另外两处提到"重试"的地方 —— 运行器不做自动重试,这段是超前于代码的设想,直接砍。
- [x] `docs/cli.md` 删除 `--json`(stdout 输出)、`--verbose`、`--no-report`、`--smoke` 四个 flag 的文档,`## 干跑与冒烟` 标题改成 `## 干跑`。
- [x] `docs/agents-and-adapters.md` 把 `Turn.events` 改成必填字段(原来写的是"可选,省略等于 `[]`")。
- [x] `docs/agents-and-adapters.md` 删掉"注册与选择"一节(`Config.agents`/`--agent` 按名字选),改成一句话说明当前就是一个 config 文件对应一个 agent。

---

## 已决定维持现状(仅记录)

- ~~`runCommand`/`runShell` 是否合并成一个 `run()`~~ —— **不合并**。查了 eve.dev 的 `sandbox.run({ command })`:它下面所有后端都固定走 `bash -lc`,不做任何注入防护,靠调用者自己用 `shellQuote()` 转义;这套设计合理是因为 eve 的调用方几乎都是 AI agent 自己的 bash 工具,生成整段 shell 命令是它们的原生表达方式。fasteval 的调用方是写 eval 的人,命令参数经常来自数据集字段或 agent 输出、内容不可控——`runCommand` 的 argv 数组形式天生不经过 shell 解析,没有注入面;合并成 shell-string 版会让每次调用都要手动转义,一旦漏转义就是真实的命令注入。已把这条理由写进 `docs/sandbox.md`("为什么 `runCommand` 和 `runShell` 不合并成一个"一节),代码不用改。

---

## 建议的处理顺序

1. **A1-A7 合并成一个"接收者模型" PR** —— 都是同一批类型(`TestContext`/`SessionHandle`/`TurnHandle`)的改动,一次做完比分开做省返工。A3、A5、A7 各有一个 ⚠️ 需要先确认的前置问题,建议先确认完再动手,别中途发现工作量翻倍。
2. **B1-B4 生命周期钩子删除**、**C1-C6 断言/Verdict/Judge 收口**、**F1 Agent 能力模型**,和 A 组没有强耦合,可以并行找人做(F2 已经做完)。
3. **D5(`writeFiles`/`uploadFiles` 签名)优先做** —— 跟 C4 一起直接解锁示例可编译性这个对外可见的问题。
4. 剩下的按模块顺序过(D 组其它条 → E 组 Runner 行为)。
