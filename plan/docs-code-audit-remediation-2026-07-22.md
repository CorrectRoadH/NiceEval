# PLAN：2026-07-22 docs↔code 审计收敛（树形 TODO）

> 面向执行者：本文件是 2026-07-22 全量审计（readSourceFiles / 警告 kind / pending 状态 / gate 阈值等 20+ 项差距）的收敛计划。审计原始行号以执行时源码为准——动手前先重新定位，不要盲信本文行号。
>
> 结构：**泳道之间并行，泳道内自上而下串行**。跨泳道依赖单独标注在节点上；没标注的节点只依赖泳道内前序节点。多执行者并行时遵守 `memory/parallel-agents-shared-git-index.md`：路径限定 `git add`、改完立即提交、只动自己泳道声明的文件。
>
> 工作树当前有未提交的 docs-site / docs 改动，属于用户或其他 agent，**不许覆盖、不许一并提交**。

## 全局规则（每个代码节点都适用）

1. **docs 是契约**。本计划所有「补代码」方向的节点，契约已在 `docs/` 定稿（多数在 2026-07-22 的 d22e666 及之前定稿），实现前先读节点里点名的契约页；docs 写不顺说明设计有问题，回对话裁决，不自行改契约。
2. **先声明后写测**：动代码前在 `docs/engineering/testing/unit/<feature>.md` 声明覆盖类别，只为已声明的类别写测试（`registry.md` 规则）。
3. **公开面变了**（导出类型 / TSDoc / flag）：跑 `pnpm docs:reference`；新 flag 核对 `src/i18n/` 两份 `--help` 速查。
4. **热点共享文件**：`src/context/types.ts`（泳道 1 与泳道 3.1 各删/改一处）、`src/runner/attempt.ts`（泳道 3.5 与泳道 4）、`docs/source-map.md`（所有泳道收尾都可能碰）。规则：对共享文件的改动单独小 commit，先 pull 再改；`source-map.md` 的更新一律放在节点收尾单独提交。
5. 统一验收（每节点完成时）：`pnpm run typecheck`、`pnpm test` 无新增失败；CLI 可观察行为变了在真实 eval 仓（`/Users/ctrdh/Code/coding-agent-memory-evals`）冒烟对照 docs 示例。

## 设计裁决（本计划锁定，不再重开）

- **readSourceFiles：删代码**。`docs/feature/sandbox/library/operations.md:30` 的「不设带过滤约定的批量读取器」是有意的设计声明（哪些扩展名算源码因项目而异，收进 API 成约定式黑箱），不是漏写。beta 无兼容包袱，直接删。
- **警告 kind：维持 provenance-over-warnings 设计**。页面级 warnings 只留三种「定位不到行的读取缺陷」（unfinished-snapshot / missing-startedAt / unreadable-snapshot）；「有效但旧」「覆盖缺口」是行级事实，走 `attempt.carried` / `scope.coverage`。这个分层（缺陷才警告，事实进数据）是对的，代码的 4 成员联合按 `plan/provenance-over-warnings.md` 收缩，不反向给 docs 加回 kind。
- **pending：补代码**。`docs/feature/adapters/architecture/events.md:53` 已把折叠语义写死：配上 result 取 result 状态（completed/failed/rejected）；只有 called、尚无 result → **pending**（HITL 停在审批上的调用就是它，不是容错分支）。`ToolCall.status` / `ToolMatch.status` 联合补 `"pending"`，`derive.ts` 的 called-无-result 从 completed 改为 pending。
- **gate 默认阈值：补代码到 1**。docs（`value-assertions.md`、`severity-and-verdict.md`、d22e666 定稿的 `custom-assertions.md`）一致要求省略阈值 = 满分线 1；代码 `score > 0` 对打分型 gate（judge 0..1）等于「任意正分即过」，太松且是隐式行为。0/1 匹配器两种语义等价，破坏面只有打分型 gate，方向正确。`src/scoring/types.ts` 的 `>0` TSDoc 同批改。
- **`.soft()` 无参：补代码**。`severity-and-verdict.md:12` 明确「无参数——要设线用 `.atLeast(x)`，不提供同义的 `soft(x)`」。代码若现存带参形态，删参数。
- **vercel keep 的 wake/suspend：先查能力再定方向**（唯一留判据、不留答案的节点，见 3.3）。判据：`@vercel/sandbox` SDK 有休眠/恢复原语 → 实现分支补齐三家一致；没有 → 按「vercel 无休眠态，kept = 运行至 TTL、enter 直连运行中实例」**整节重写** `docs/feature/sandbox/cli.md` 与 `architecture.md` 受影响小节（不打差分补丁），代码报错文案指向该契约。
- **docs-first 在建特性（defineScoreEval / error-classification / local / hard-kill）不算「污染」**：docs 先于代码是本仓正常流程，`agent-contract.md` 的 `classifyTurnError?` 与 `EvalDescriptor.scoring` 不回退，靠对应节点落地闭合。

---

## 树

```
审计收敛
├── 泳道 1 · 评分与事件契约（串行）
│   ├── 1.1 pending 状态 + context.injected（o11y 折叠面对齐）
│   ├── 1.2 ToolMatch/SubagentMatch 谓词形态 + input 顶层 RegExp bug
│   ├── 1.3 gate 默认阈值 → 1
│   ├── 1.4 .soft() 无参化
│   └── 1.5 defineScoreEval / 计分制题型（最大件，压轴）
├── 泳道 2 · results / reports（串行）
│   ├── 2.1 执行 plan/provenance-over-warnings.md（警告收缩 + carried + fresh）
│   └── 2.2 panel.ts 框线渲染件（依赖 3.3 落地后再接 sandbox/cli-commands 消费方）
├── 泳道 3 · sandbox 生命周期（串行）
│   ├── 3.1 沙箱读写面对齐：删 readSourceFiles + 增 downloadDirectory
│   ├── 3.2 kept 条目 expiresAt 写入修复（真 bug）
│   ├── 3.3 vercel 能力裁决 + enter/history/diff 三家一致化
│   ├── 3.4 执行 plan/local-provider.md
│   └── 3.5 执行 plan/hard-kill-recovery.md（--teardown 落盘 / 孤儿核对 / attempt 携带）
├── 泳道 4 · turn 错误分类（单节点）
│   └── 4.1 执行 plan/error-classification.md
└── 泳道 5 · 纯文档修正（节点间互相并行，与代码泳道并行）
    ├── 5.1 source-map.md 落点修正
    └── 5.2 契约文档补漏（代码为真相的 code-extra 面）
```

启动顺序建议：四条代码泳道同时开工，各自从第一个节点做起——1.1、2.1、3.1 就是审计里「用户今天就会写出跑不通的 eval」的直接矛盾项，天然先做；5 可随时插空。

---

## 泳道 1 · 评分与事件契约

### 1.1 pending 状态 + context.injected

- 契约：`docs/feature/adapters/architecture/events.md`（折叠语义、`context.injected` 成员、`contextInjections` 计数）、`docs/feature/scoring/library/scoped-assertions.md:49,64-66`。
- 改动：`src/o11y/types.ts` `ToolCall.status` 补 `"pending"`、`StreamEvent` 联合补 `{type:"context.injected"}` 成员；`src/o11y/derive.ts` called-无-result → pending、`DerivedFacts` 补 `contextInjections`；`src/context/types.ts` `ToolMatch.status` 补 `"pending"`（`SubagentMatch` 按 docs 是 `pending|completed|failed`，无 rejected）。
- 语义迁移注意：现有断言若依赖「无 result 也算 completed」会翻红——逐个核对是测试假设错还是流确实不发 result；不带 `status` 过滤的 `calledTool` 匹配任意状态，主路径不受影响。
- 验收：`docs/engineering/testing/unit/` 对应登记行变绿；`calledTool("x",{status:"pending"})` 类型通过且对「called 无 result」的 fixture 命中；`deriveRunFacts` 对含 `context.injected` 的事件流计数正确。

### 1.2 ToolMatch/SubagentMatch 谓词形态 + input bug

- 契约：`scoped-assertions.md`（`output?`：RegExp/谓词/深比对；`count?: number | (n)=>boolean`；`remoteUrl?: string|RegExp|(url)=>boolean`；`input` 顶层 RegExp/谓词）。
- 改动：`src/context/types.ts` 类型扩到契约形态；`src/context/scoped.ts` 匹配实现补齐。**必修 bug**：`input` 顶层传 RegExp 时现在枚举 RegExp 自身的空 entries → 匹配一切，静默假通过；改后非 plain-object 的 `input` 走 RegExp/谓词分支，不允许再落入深比对。
- 顺手（同文件收尾）：`ToolMatch.input` JSDoc「浅层包含」改为与运行时一致的「深度部分匹配」；`t.respond` 字符串形 TSDoc（`src/context/types.ts:258` 附近）改为与 `context.ts` 实际行为一致——多个 pending 时抛 `hitl.stringAmbiguous`，不是「按顺序对应」；`AssertionResult.loc` 注释 `--eval` → `--source`。
- 验收：docs 里的每个示例形态（谓词 count、RegExp remoteUrl、output 深比对、input 顶层 RegExp）各有一条测试；旧「RegExp input 匹配一切」行为有回归测试锁死为不匹配/按 RegExp 匹配。

### 1.3 gate 默认阈值 → 1

- 契约：`value-assertions.md:54-58`、`severity-and-verdict.md:10-12`、`custom-assertions.md:49`。
- 改动：`src/scoring/collector.ts` threshold 省略时判 `score >= 1`；`src/scoring/types.ts` 的 `>0` TSDoc 同步；公开面变了跑 `pnpm docs:reference`。
- 验收：0/1 匹配器行为不变（回归测试）；judge 类打分 gate 省略阈值时 0.7 分 fail、1.0 分 pass 各一条测试。

### 1.4 `.soft()` 无参化

- 契约：`severity-and-verdict.md:12`、`value-assertions.md:58`。
- 改动：链式 `.soft()` 签名去参数（现存带参调用点全仓 grep 清理）；类型层拒绝 `soft(0.5)`。
- 验收：`pnpm run typecheck`；`.soft()` 断言落盘分数、永不 fail、`--strict` 下仍只记录（`strict-quality-gate.md:33`）各一条测试。

### 1.5 defineScoreEval / 计分制题型

- 契约：计分制的 8 篇 docs（经 `docs/README.md` 索引定位；含 `defineScoreEval`、`t.score(label,n)`、`.points(n)`、`EvalDescriptor.scoring: "pass"|"points"`、混型启动校验、README.md:50 的 `e.scoring==="points"` 实验过滤）。
- 改动：`src/define.ts` / `src/runner/types.ts`（`EvalDescriptor.scoring`）/ `src/scoring/` / 报表面。这是全新题型，体量最大，故压轴；若执行时发现契约与泳道 1 前四节点的落地冲突，回对话裁决。
- 验收：docs 用例照抄能跑；`EvalDescriptor.scoring` 有值（消灭「谓词读 undefined」）；混型实验启动校验报错文案与 docs 一致；真实 eval 仓冒烟一条计分制 eval。

## 泳道 2 · results / reports

### 2.1 执行 `plan/provenance-over-warnings.md`

- 覆盖审计项：警告 kind 5→3（删 `partial-coverage` / `stale-snapshot` 产出与类型成员）、`attempt.carried`、`scope.coverage`、`latest()/current()` 的 `fresh` 选项、`--fresh` flag、报表 `↩` 标注与占位行。执行项、落点、验收全在该 plan，不复述。
- 验收：以该 plan 第 5、6 条为准；另加一条本审计的回归：`src/results/types.ts` 的 `ScopeWarning` 联合成员恰为三种，`select.ts` 无残留 push。

### 2.2 panel.ts 框线渲染件（依赖 3.3）

- 契约：`docs/feature/reports/library/layout.md`「区域框」、`docs/cli.md`「终端框线：一个渲染件全仓消费」；`source-map.md:175` 已登记缺失。
- 改动：先落 `src/report/model/panel.ts` 渲染件，再接三处消费方：`Section` text 面、`runner/feedback/human.ts` live/结束面板、`sandbox/cli-commands.ts` 的 `list`/`history` 输出。**跨泳道依赖**：`sandbox/cli-commands.ts` 归泳道 3 所有，等 3.3 落地后再动它；前两处消费方不受此依赖限制，可先接。
- 验收：三处消费方无各自拼框字符（grep `╭`/`╰` 只剩 panel.ts）；`pnpm run build:report`；`sandbox history` 输出与 `sandbox/cli.md` 的框线示例一致。

## 泳道 3 · sandbox 生命周期

### 3.1 沙箱读写面对齐：删 readSourceFiles + 增 downloadDirectory

- 同一批文件（`src/sandbox/types.ts`、`docker.ts`、`e2b.ts`、`vercel.ts`、`src/context/types.ts`）的一删一增，合为一个节点避免两次动 provider 面。
- 删：`readSourceFiles` 方法（Sandbox / SandboxHandle / TestContext）、`SourceFile` / `ReadSourceFilesOptions` 类型、`src/sandbox/source-files.ts`、三 provider 实现与导出。
- 增：`downloadDirectory`（契约：`docs/feature/sandbox/README.md:42`、`library/operations.md:14,41-49`——与 `uploadDirectory` 对称，递归下载，计入幂等文件操作重试清单 `src/sandbox/retry.ts`）。
- 验收：`grep -rn readSourceFiles src/ docs/` 双零命中；downloadDirectory 三 provider 各一条测试 + 真实 docker 冒烟（上传目录→沙箱内改文件→下载目录→内容一致）；`pnpm docs:reference`。

### 3.2 kept 条目 expiresAt 写入修复

- 真 bug：`architecture.md:69,77` 与 `keep-registry` 契约要求云 provider 留存时算出 `expiresAt` 落注册表，`attempt.ts` 的 `writeKeptEntry` 从不写，`list` 的过期分支读恒缺字段。
- 改动：留存提交时按 provider TTL 语义计算并写入（vercel 按真实 session 寿命照实算，见 `memory/vercel-sandbox-issues.md`；e2b 按模板/timeout）；docker 不写。
- 验收：单测覆盖 e2b/vercel 条目含合理 `expiresAt`、docker 条目无该字段；`sandbox list` 过期分支对过期条目报 `expired`。

### 3.3 vercel 能力裁决 + enter/history/diff 三家一致化

- 第一步（调查，产出裁决）：查 `@vercel/sandbox` SDK 是否有休眠/恢复原语，结论与出处记 memory 一条。按「设计裁决」节的判据二选一：
  - 有 → 补 `keep.ts` 的 `wakeDetached` / `suspendDetached` vercel 分支、`nativeEnterCommand` 返回真实命令；docs 不动。
  - 无 → 整节重写 `docs/feature/sandbox/cli.md` 与 `architecture.md` 中 vercel 留存/唤醒的表述（vercel 无休眠态，kept = 运行至 TTL、enter 直连、到期即 expired）；代码报错文案指向该契约。
- 第二步：`sandbox enter` / `history` / `diff` 按 `sandbox/cli.md:85-120` 的统一语义落齐 docker/e2b（唤醒→操作→回眠、条目级 lease、`--leave-running`）；vercel 按裁决结果接入或声明。`cli-commands.ts` 消灭「非 docker 直接抛」的分支——provider 差异收进 provider 能力方法，CLI 层报统一的「provider 不支持」错误（Architecture Boundaries 规则）。
- 验收：docker 全链路手测（keep→list→enter→exit 回眠→history→diff→stop）；e2b 至少 enter+stop 真机一次；lease 互斥有单测（enter 持有时 stop 拒绝并报 holder）。

### 3.4 执行 `plan/local-provider.md`

- 覆盖审计项：`localSandbox()` 整个 provider。执行项与验收全在该 plan。放在 3.3 之后：resolve.ts / cli 面在前序节点稳定后再加新 provider，减少同文件返工。

### 3.5 执行 `plan/hard-kill-recovery.md`

- 覆盖审计项：`--teardown` flag + `.niceeval/teardowns/` 落盘登记与启动自愈、`sandbox prune` / `list --orphans` / create 期 run-identity 元数据、attempt 粒度携带。执行项与验收全在该 plan（其阶段 1/2/3 在本树内视为 3.5 的三个串行子节点）。
- 与泳道 4 共享 `src/runner/attempt.ts`：先 pull 再改，冲突按函数粒度手工合。

## 泳道 4 · turn 错误分类

### 4.1 执行 `plan/error-classification.md`

- 覆盖审计项：`classifyTurnError` / `TurnFailure` / 重试预算全套，同时闭合 `agent-contract.md:17` 已声明的 `Agent.classifyTurnError?`。执行项与验收全在该 plan。
- 与泳道 1 无文件交集（session.ts / turn-errors.ts / agents/types.ts），可全程并行。

## 泳道 5 · 纯文档修正（互相并行）

### 5.1 source-map.md 落点修正

- `:120` `AttemptRecord` → 实际落盘类型 `EvalResult`（`src/runner/types.ts:158`），连带 `RESULTS_SCHEMA_VERSION` 的关系表述改对。
- `:133` 警告 kind 表述：2.1 落地前如实写四成员现状会立刻过期——直接等 2.1 收尾时由泳道 2 更新为三种（本节点跳过此行，标注归属即可）。
- `:174` 无参 `.soft()`、`:175` panel.ts：分别由 1.4、2.2 落地后从「已知差异」删除；本节点只修 `:120` 与 `:35,:36`（langgraph/openclaw 不存在的文件指向，改为指向 docs 契约页并挂进已知差异）。
- 验收：`pnpm test`（docs 一致性测试）；source-map 里 grep 不到指向不存在文件的落点。

### 5.2 契约文档补漏（代码为真相的 code-extra 面）

- `agent-contract.md:44` 类型块补 `AgentContext.log`；`CommandOptions.onStdout/onStderr`、`Results.root` 在对应 library 页补声明。
- `src/scoring/judge.ts:4` 注释与 `source-map.md:171` 补 `OPENAI_BASE_URL` / `OPENAI_API_KEY` 兜底解析顺序（代码 `judge.ts:23-33` 为真相）。
- 验收：`pnpm test`；改了 TSDoc 的跑 `pnpm docs:reference` 确认参考页区块无漂移报错。

---

## 全树完成定义

- [ ] 泳道 1–4 所有节点的「验收」逐条有证据（测试名 / 命令输出 / commit），不以「代码提交了」代替。
- [ ] `pnpm run typecheck`、`pnpm test` 全绿；`pnpm docs:reference` 后无生成区块漂移。
- [ ] 真实 eval 仓冒烟清单全过：pending 断言（1.1）、计分制 eval（1.5）、`--fresh`（2.1）、downloadDirectory（3.1）、keep 全链路（3.3）、local provider（3.4）、kill -9 恢复（3.5）。
- [ ] 审计清单逐项回销：每项要么指向落地 commit，要么指向本计划里明确改了方向的裁决；不允许「静默不做」。
- [ ] 过程中翻案 / 反直觉修法记 memory 并索引（含 3.3 的 SDK 能力调查结论）。
