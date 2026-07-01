# Assertions —— 断言参考(作用域 + 来源)

这一篇是断言的速查参考:每条**做什么**、**看哪一轮**、**来源哪里**(以及哪些是 fasteval 自创)。怎么把它们组织进一个 eval,见 [Eval Authoring](eval-authoring.md);判决规则与 judge 细节见 [Scoring](scoring.md)。

> **来源一句话:** 整套断言 DX(声明式、路径即身份、gate/soft 分层、LLM-as-judge、`t.events` 逃生舱)借自 **eve.dev evals**;沙箱 / diff 这类借自 **Vercel agent-eval**;`--budget` 等护栏借鉴 **crabbox**;`closedQA`/`factuality`/`summarizes` 直接用 **autoevals(Braintrust)**。逐条见下方各表的「来源」列与文末[来源一览](#来源一览--哪些是-fasteval-自创)。

断言是 eval 给 `test(t)` 的产出打分的方式。每条记录一个结果、返回可链式的 handle;runner 收齐**所有**记录再算判决,所以一次运行会报告**每一条**失败断言,而不是遇到第一个就停。

## 作用域:三层(看哪一轮)

多轮里最容易错的是「这条到底看哪一轮?」。别逐个背,按层记:

| 层 | 谁 | 作用域 |
|---|---|---|
| **值级** | `t.check(value, …)`、judge 的 `{ on }` | 评你传进去的值;**默认值 = `t.reply` = 最后一轮** assistant 消息。judge 默认 `on: t.reply`,且默认 soft |
| **run 级 / 作用域级** | `t.succeeded` / `t.messageIncludes` / `t.calledTool` / `t.event` … / `t.sandbox.*`(工作区) | `test` 跑完后对**整次运行(所有轮)**评估 |
| **轮级** | `t.send()` 返回的 turn 上:`turn.message` / `turn.messageIncludes` / `turn.outputEquals` | 只看**那一轮** |

所以「`t.messageIncludes` 看所有轮、judge 默认看最后一轮」并不矛盾:前者 run 级、后者值级默认。要评整段多轮对话(judge 跨轮一致性),显式传 `{ on: t.transcript.text() }`,写法见 [Eval Authoring · 多轮里评整段对话](eval-authoring.md#多轮里评整段对话)。

## run 级断言(`t` 上,跑完后评估)

读自[标准事件流](agents-and-adapters.md)与其派生事实——只要 adapter 产出标准 `events`,对任何 agent 都成立。全部默认 **gate**。

| 断言 | 作用 | 来源 |
|---|---|---|
| `t.succeeded()` | 运行没失败、且没卡在未回答的 HITL | eve.dev |
| `t.parked()` | 干净停在 HITL 输入上 | eve.dev |
| `t.messageIncludes(token)` | **所有轮**的 assistant 文本拼接后含 token(串 / 正则) | eve.dev |
| `t.calledTool(name, match?)` | 有匹配 name + input + status 的工具调用(可精确计数) | eve.dev |
| `t.notCalledTool(name, match?)` | 没有匹配的工具调用 | eve.dev |
| `t.toolOrder([...names])` | 工具调用按给定子序出现 | eve.dev |
| `t.usedNoTools()` | 完全没调工具 | eve.dev |
| `t.maxToolCalls(n)` | 工具调用数 ≤ n | eve.dev |
| `t.loadedSkill(skill)` | = `calledTool("load_skill", { input: { skill } })` 的糖 | eve.dev |
| `t.calledSubagent(name, match?)` ⚠ | 子 agent 委派匹配(同 `ToolMatch` 小语言) | 待核实 —— 未见于 `src/types.ts` |
| `t.noFailedActions()` | 没有 failed 的工具 / 子 agent 动作 | eve.dev |
| `t.event(type, { count? })` | 出现(或恰好 count 个)某类型事件 | eve.dev |
| `t.notEvent(type)` | 没出现某类型事件 | eve.dev |
| `t.eventOrder([...types])` ⚠ | 事件分组按给定顺序出现 | 待核实 —— 未见于 `src/types.ts` |
| `t.eventsSatisfy(label, predicate)` ⚠ | 自定义谓词直接查 `events` | 待核实 —— 未见于 `src/types.ts` |
| `t.maxTokens(n)` | 整次 input + output token ≤ n | fasteval(用量聚合,补 agent-eval 的 TODO) |
| `t.maxCost(usd)` | 估算成本 ≤ usd(需价格表) | **fasteval 自创**(预算护栏思路借鉴 crabbox) |

⚠ 标记的三条抄自旧版 `scoring.md`,但当前 `src/types.ts` 的 `TestContext` 上没有对应方法 —— 不像 `t.sandbox.*` 那样有「设计文档先行,代码待迁移」的迁移记录(见下方来源一览),状态不明。发现这篇文档的人先按「未实现」处理,别当已有能力用;要不要保留 / 实现 / 删除,找项目负责人确认。

## 工作区断言(`t.sandbox.*`,仅 workspace 能力)

凡是「工作区 / 沙箱」相关的——句柄、diff、断言、agent-as-judge——都挂在 **`t.sandbox`** 命名空间下。没有 `workspace` 能力的 agent 干脆**没有 `t.sandbox`**,所以「能不能对工作区断言」一眼可见(命名空间在不在),而不是某些平铺方法悄悄消失。

| `t.sandbox.*` | 作用 |
|---|---|
| `fileChanged(path)` | 该文件出现在生成 diff 里 |
| `fileDeleted(path)` | 该文件被删 |
| `notInDiff(re)` | 改动里不含某模式(密钥、内联 style…) |
| `testsPassed()` | `EVAL.ts`(Vitest)全绿 |
| `scriptPassed(script)` | 指定 npm 脚本退出 0 |
| `noFailedShellCommands()` | 没有 failed 的 shell 工具调用 |
| `judge(question, { on?, model? })` | agent-as-judge:让裁判读工作区产物(diff)打分(原 `t.judge.agent`) |

非断言的访问器也在 `t.sandbox` 下:`t.sandbox.diff`(`.get(path)` / `.isEmpty()` / `.matches(re)`)、`t.sandbox.runCommand` / `.readFile` / …(底层句柄)、`t.sandbox.file(path)`(延迟文件引用)。

**来源**:这些断言本身来自 **Vercel agent-eval**;把它们统一收进 `t.sandbox` 命名空间、以及 agent-as-judge 落成 `t.sandbox.judge`,是 **fasteval 自己的组织决定**——eve 的 eval `t` 并没有 sandbox 断言面(eve 用 `t.calledTool` + `t.messageIncludes` 断言文件工具行为)。

## 轮级断言(`t.send()` 返回的 turn 上)

只看**那一轮**。来源 **eve.dev**(turn handle 模型)。

| 断言 | 作用 |
|---|---|
| `turn.expectOk()` | 本轮 failed 就抛(带最后一条 error 诊断),否则可链 |
| `turn.messageIncludes(token)` | **本轮**消息含 token(不跨轮) |
| `turn.outputEquals(value)` | `turn.data` 深度相等 |
| `turn.outputMatches(schema)` | `turn.data` 过 Standard Schema / zod 校验 |

(`turn.message` / `turn.data` / `turn.usage` / `turn.status` / `turn.events` 是只读字段,不是断言。)

## 值级断言:`t.check` / `t.require` + 匹配器

- `t.check(value, matcher)` —— 记录一条**延迟**断言(`t.file()` 的 `FileRef` 到 finalize 才读)。
- `t.require(value, matcher)` —— **立即**评估、记成 gate,不过就抛 `EvalRequirementFailed` 中止后续(前置条件)。

来源 **eve.dev**。匹配器从 `fasteval/expect` 导入,都返回可链式 `.gate()` / `.soft(t?)` / `.atLeast(t)` 的 `ValueAssertion`:

| 匹配器 | 打分 | 默认严重级 | 来源 |
|---|---|---|---|
| `includes(needle, opts?)` | 含子串 / 命中正则 | gate | eve.dev |
| `equals(expected)` | 深度相等(NaN / Date / 数组 / 对象) | gate | eve.dev |
| `matches(schema)` | Standard Schema / zod 校验 | gate | eve.dev |
| `similarity(expected)` | 归一化 Levenshtein `[0,1]` | **soft, 0.6** | eve.dev |
| `satisfies(pred, label?)` | 自定义谓词 | gate | eve.dev |
| `makeAssertion({ … })` | 自定义断言工厂 | 可配(默认 gate) | eve.dev |
| `excludes(needle, opts?)` | `includes` 取反 | gate | **fasteval 扩展** |
| `isDefined(label?)` | `value != null` | gate | **fasteval 扩展** |
| `isTrue(label?)` / `isFalse(label?)` | 严格等于 `true` / `false` | gate | **fasteval 扩展** |

## 匹配小语言(`ToolMatch`)

`calledTool` / `notCalledTool` 的第二参用同一套部分深度匹配,来源 eve.dev:

- `input` —— 字面量(深度部分匹配)/ 正则(对序列化串)/ 谓词函数;
- `count` —— 精确计数;
- `status` —— 按 `completed` / `failed` / `rejected` 过滤。

## 逃生舱:原始事件流 / 派生数据

规则覆盖不到的奇怪断言,直接落到事件流上自己写:

- `t.transcript.events()` —— 整次运行所有 `StreamEvent`(`t.event` / `t.notEvent` 是它的语法糖)。来源:`t.events` 逃生舱思路 **eve.dev**,transcript 归一化 **Vercel agent-eval**。
- `t.transcript.text()` —— 把全程拼成 `role: text` 多行,给 judge 喂整段多轮对话用。**fasteval 自创**。
- `t.transcript.compactions()` —— 自动压缩次数(capability 不可观测时 `undefined`)。
- `t.usage`(`{ inputTokens, outputTokens, cacheReadTokens?, … }`)—— 累计用量(平铺,agent 中立),`test` 里随时可读,不止 `maxTokens`/`maxCost` 两条断言用得上,也能自己拿字段配 `t.check` 写别的效率断言(如 `t.check(t.usage.outputTokens, satisfies((n) => n < 10_000, "输出不啰嗦"))`)。工作区相关的访问器(`t.sandbox.diff` / 句柄 / `t.sandbox.file`)见[工作区断言](#工作区断言tsandbox仅-workspace-能力)。

## 严重级:gate vs soft

- **gate** —— 硬要求,不过 → 整个 eval failed。`includes` / `equals` 等默认 gate;**带阈值的 `.atLeast(x)` 也是 gate**。
- **soft** —— 只记分、永不挂。`.soft(threshold?)` 显式声明;`similarity` 不带阈值、judge 不带阈值时默认 soft。

链式改写:`.gate()` / `.soft(t?)` / `.atLeast(t)`。判决规则(verdict / outcome)见 [Scoring · 判决规则](scoring.md#判决规则)。来源 **eve.dev**。

## LLM-as-judge

judge 在 [Scoring · LLM-as-judge](scoring.md#3-llm-as-judge) 详述,这里只记**作用域**与**来源**:

| judge | 作用 | 来源 |
|---|---|---|
| `t.judge.closedQA(criteria, { on?, model? })` | 闭合式判断 | autoevals(Braintrust) |
| `t.judge.factuality(expected, …)` | 事实一致性 | autoevals(Braintrust) |
| `t.judge.summarizes(source, …)` | 是否忠实摘要 | autoevals(Braintrust) |
| `t.judge.autoevals.{closedQA,factuality,summarizes}` | 同上,显式子命名空间 | autoevals(Braintrust) |
| `t.judge.score(rubric, …)` | 按自定义评分标准打分 | **fasteval 自创** |

> 「评工作区产物(diff)」的 agent-as-judge 不在 `t.judge` 下,而是 [`t.sandbox.judge(question)`](#工作区断言tsandbox仅-workspace-能力)(原 `t.judge.agent`,仅 workspace 能力)。

- **`{ on }`** = 被评的值(默认 `t.reply` = 最后一轮);可传沙箱文件路径或一段字面文本。judge 接口(`{ on }` / 默认 soft)来源 eve.dev。
- **默认材料**:flat 的 `score` / `closedQA` / `factuality` / `summarizes` 一律默认 `t.reply`(最后一轮)。要评**工作区产物(diff)**用 `t.sandbox.judge`;要评**整段多轮对话**用 `{ on: t.transcript.text() }`。

## 来源一览 & 哪些是 fasteval 自创

| 来源 | 给了 fasteval 什么 | 出处 |
|---|---|---|
| **eve.dev evals** | 声明式 DX、路径即身份、gate/soft 分层、scoped / value / turn 断言形态、`t.check`/`require`、匹配器、LLM-judge 接口、`t.events` 逃生舱 | `docs/architecture.md:95`、`docs/README.md:15` |
| **Vercel agent-eval** | Adapter / Sandbox 工程形状、沙箱断言(`fileChanged` / `testsPassed`/…)、transcript 归一化与可观测、experiment 层、本地 `fasteval view` | `docs/vision.md:79`、`docs/experiments.md:10` |
| **crabbox** | capability 分发纪律、`--budget` / `maxCost` 的 spend cap、source-map 文档观 | `docs/vision.md:9,80`、`docs/runner.md:50` |
| **autoevals(Braintrust)** | `closedQA` / `factuality` / `summarizes` 评判器 | `src/scoring/judge.ts:7-10` |

**fasteval 自创(不在以上任何来源里):**

- **`t.sandbox.judge`(原 `t.judge.agent`)/ `t.judge.score`** —— 我们自己的开放式评判(`judge.ts:7-8` 注明「agent / score 是我们自己的,不在 autoevals 里」)。
- **把 workspace 断言 / diff / agent-as-judge 统一收进 `t.sandbox` 命名空间** —— 组织决定,eve 的 eval `t` 没有 sandbox 断言面。
- **`t.transcript.text()`** —— 把整段多轮对话拼给 judge,填「judge 默认只看最后一轮」的缺口。
- **成本聚合** —— 用量 → 成本价格表估算 + `t.maxCost()`(eve 不聚合成本、agent-eval 只留了 TODO,fasteval 补齐;预算护栏的 spend-cap 思路借鉴 crabbox)。
- **匹配器扩展** —— `excludes` / `isDefined` / `isTrue` / `isFalse`。
- **可本地化的项目 `name`、读结果目录出图的 `fasteval view`。**

## 接下来读什么

- [Eval Authoring](eval-authoring.md) —— 怎么把这些断言组织进单轮 / 多轮 / 数据集 eval。
- [Scoring](scoring.md) —— 判决规则、judge 细节、效率 / 成本断言。
- [Agents 与 Adapters](agents-and-adapters.md) —— 断言读的标准事件流从哪来。
- [Observability](observability.md) —— transcript / usage / cost 的数据来源。
