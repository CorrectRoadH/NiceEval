# Scoped Attempt Feedback —— adapter/provider 的结构化进度与诊断

`AttemptPhase`(见 [Experiments CLI「Attempt 阶段」](../feature/experiments/cli.md#attempt-阶段))今天是 runner 单方面维护的闭集合投影:`attempt.ts` 沿自己的固定执行顺序在真正跨入每一步时发出 phase 转换,adapter、Sandbox provider、`SandboxSpec.setup/teardown` hook、`EvalDef.setup/test`、Telemetry、Scoring 都不能设置或影响这个字段。它们目前唯一能表达"当前在做什么"的出口是 `AgentContext.log`(`ctx.log(...)`)—— 一句自由文本,原样挂到 runner 当前认定的 phase 上作为 `detail`,只更新 Human dashboard 当前 active 行的次要文本,`agent` / `ci` profile 完全不展示,也不落进任何结果文件。

## 要解决的问题

`AgentContext.log` 是单一、无结构、无级别的字符串通道,这带来两类真实限度:

- **Sandbox provider 的临时状态没有专属出口。** provisioning 阶段的 retry/backoff、镜像拉取进度、snapshot 恢复只能塞进同一条 `log`,和 agent 自己的执行日志混在一起,无法被单独去重、分级或在 `agent` / `ci` profile 里升级成结构化诊断。
- **没有 warning/error 级别的区分。** 一次性的、需要保留的诊断(如"memory warmup 失败,已降级为冷索引")与逐帧刷新的临时进度(如"npm install: 42%")经由同一个 `log()` 出口,调用方自己决定要不要重复调用来模拟去重,runner 没有统一的去重 key 机制可用。
- **owner 边界没有类型层面的约束。** 因为大家共享同一个 `log()`,没有任何机制阻止一个 `EvalDef.setup` 钩子写出看起来像是 agent 执行状态的文本,或反过来——这依赖调用方自觉,不是契约保证的。

## 候选契约:按 owner 分层的 operation scope

把 `AttemptPhase` 背后的每一步都建模成一个 runner 创建并绑定的 operation scope,对应的 owner 拿到一份专属 `ScopedFeedback` 句柄,离开各自的边界就拿不到:

```ts
interface ScopedFeedback {
  /** 短命 activity:只更新 Human 当前行的 detail;Agent/CI 不逐条输出。 */
  progress(update: { message: string; current?: number; total?: number }): void;
  /** 需要保留的 warning/error:进入三种 profile 的永久事件流,按 dedupeKey 去重。 */
  diagnostic(input: { code: string; level: "warning" | "error"; message: string; data?: unknown; dedupeKey?: string }): void;
}
```

`ScopedFeedback` 不暴露设置 `phase` / `scope` 或任何终端控制的方法——runner 收到 operation 的 start/end 后按固定映射推出 `AttemptPhase`,调用方只能在这份映射已经打开的窗口内报告信息,不能声称进入了另一个生命周期阶段:

| Lifecycle owner | Runner 打开的 operation | 这一层可以表达什么 | 不能表达什么 |
|---|---|---|---|
| Sandbox provider | `sandbox.provision` | 分配实例、拉镜像、恢复 snapshot、retry/backoff 的临时 activity;最终 provision diagnostic | 把 phase 改成 agent setup / running |
| `SandboxSpec.setup/teardown` hook | `sandbox.setup` / `sandbox.teardown` | 环境安装、缓存恢复/回填、hook 文件准备进度 | 声称 eval/agent 已开始或完成 |
| Runner workspace | `workspace.prepare` / `workspace.diff` | 上传、git baseline、采 diff | 输出 adapter 自由日志 |
| `EvalDef.setup/test` | `eval.setup` / `eval.run` | 任务依赖准备、eval 主体的短进度和诊断 | 控制 sandbox/agent lifecycle |
| Agent adapter | `agent.setup` / `agent.run` / `agent.teardown` | CLI/Skill/plugin 安装、配置、turn/tool 进度、adapter 诊断 | 直接写终端或切换顶层 phase |
| Telemetry | `telemetry.configure` / `telemetry.collect` | endpoint 配置、span collect 的短进度和诊断 | 用 trace 消息覆盖 running/scoring phase |
| Scoring | `scoring.evaluate` | 断言/judge 进度和诊断 | 改写 agent 执行阶段 |

`AgentContext.log` 在这个候选契约下的去向是一个待裁决问题(保留作兜底、收窄成 `agent.run` scope 的 `progress()` 别名、还是整体废弃),不是这份提案已经决定的部分。

## 待裁决分歧

- **签名怎么落到调用点。** `Sandbox` provider 的 `create()`、`SandboxSpec.setup/teardown`、`EvalDef.setup/test`、`Agent.setup/send/teardown`、Telemetry、Scoring 的现有函数签名要不要各自新增一个 `feedback: ScopedFeedback` 参数,还是挂在已有的 `ctx` / ` ` 对象上作为新字段——两种都改变今天六类扩展点里若干个的公开类型,需要逐一核对是不是破坏性变更。
- **怎么守住 core 中立边界。** 让 runner 正确地把每个 operation 绑定到对应 owner、且不允许调用方越权改变 Attempt 状态机,容易在 `runner/run.ts` / `runner/attempt.ts` 这类核心调度路径里长出 `agent == X` / `sandbox == Y` 式的特判分支——落地时必须先排除这种写法,对接口分发,不按名字分支(见 [Architecture](../architecture.md) 的核心边界)。
- **发布时机。** 六类第三方扩展点一次性获得一份新的稳定公开契约,收窄成本远高于观望成本。更安全的顺序是先让今天这套 runner 内部 phase 投影在真实的 human / agent / ci 三种反馈里跑够久、映射关系跑稳,观察到哪些 owner 真的需要结构化 progress/diagnostic(而不是想象出全部六类都需要),再决定按什么确切形状对外暴露。

设计定稿后,这份文档按目标形态重写并整篇移入 [`../feature/experiments/`](../feature/experiments/README.md),`docs/feature/experiments/cli.md`「Attempt 阶段」一节同步展开引用这份契约,不在原地留状态标记。

## 相关阅读

- [Experiments CLI](../feature/experiments/cli.md) —— `AttemptPhase` 当前实际投影的枚举与展示规则。
- 设计裁决出处:`memory/attempt-phase-scoped-feedback-api-deferred.md`(推迟本提案的完整理由与适用场景判断)。
