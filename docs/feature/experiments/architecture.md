# Experiments —— 架构

## 从 agent-eval 砍掉了什么(以及为什么)

agent-eval 的 `ExperimentConfig` 字段一半是它自己业务的耦合或可下放的。niceeval 的 `defineExperiment` 只留**纯运行矩阵**:

| agent-eval 字段 | niceeval | 处置 | 理由 |
|---|---|---|---|
| `agent` | `agent` | 保留,但一文件一个 agent | 沿用 agent;文件夹表达"可比组"(见 [Library · 实验怎么组织](library.md#实验怎么组织文件夹--一组可对比的实验)) |
| `model` / `runs` / `earlyExit` / `evals` / `timeout` / `sandbox` | 同(`timeout`→`timeoutMs`) | 保留 | 运行矩阵的本体 |
| `setup` | — | **删** | 环境预置不进 experiment 本身:按实验变化的环境挂在 `sandbox` 字段的 `SandboxSpec.setup()` / `.teardown()`,任务夹具写 `EvalDef.setup` / `test()`,连 agent 写 `SandboxAgent.setup`,整个 run 共享服务用外部编排(见 [环境预置放哪](../sandbox/library.md#环境预置放哪)) |
| `validation` | — | **删** | 「怎么算对」是 eval 自己的事(`test()` 里手工跑校验命令),不该由 experiment 决定 |
| `scripts` | — | **删** | 同上,属于 eval / fixture 的评分,不是运行配置 |
| `brands` | — | **删** | Vercel 品牌追踪专用,通用 evals 不需要 |
| `editPrompt` | — | **删** | 改写 prompt 太 niche,需要时在 agent/eval 里做 |
| `onRunComplete` | — | **删** | 下游**分析**交给 [reporter](../../observability.md#reporters);**资源起停**不由 experiment 钩子管,靠外部编排 / `SandboxAgent.setup` / `SandboxSpec.setup()` / `.teardown()` / `test()`(见 [环境预置放哪](../sandbox/library.md#环境预置放哪)) |
| `modelPolicy` | — | **删** | 折进「`model` 省略 = 原生默认」 |
| `copyFiles` | — | **删** | 和 diff 冗余:git 基线是空 commit,`t.sandbox.diff.get(path)` 拿到的就是完整新文件内容,不必再单独拷一份 |
| `webResearch` / `agentOptions` | `flags` | **合并** | 一个通用参数袋取代散落的开关,经 `ctx.flags` / `t.flags` 透传 |
| — | `budget` | **加** | 实验级成本上限,接 [用量与成本](../../observability.md#用量与成本token--计费) |

一句话:**experiment 只管"跑什么、跑几次、花多少",不碰"怎么算对"。** 评分细节全在 eval。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Library](library.md) —— model/flags 怎么透传、实验怎么按文件夹组织。
