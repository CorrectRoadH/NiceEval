# Agents 与 Adapters

这一组文档讲 niceeval 如何"连到一个被测对象"。这是整个库最容易被想歪的地方,先把两个核心论点摆出来:

> 1. **niceeval 不定义任何 agent 协议。** 每一个被测对象——你自己的 agent、你的后端服务、Claude Code / Codex 这种 coding agent——**都是自己实现的 adapter**。experiment 引用 agent,而不是给一个 url。
> 2. **adapter 真正的难点不是"连上",而是把各 agent 五花八门的原始返回归一化成一套标准的事件流。** 归一化之后,整套断言都是免费的、与 agent 无关的。

两个词:

- **Agent** —— 抽象。niceeval 眼里"一个被测对象",带能力位,由 experiment 引用。运行器只认 Agent 契约。
- **Adapter** —— 实现。某个 agent 的具体代码,**由用户编写**(niceeval 也内置几个常用 coding agent)。一个 Adapter 实现一个 Agent。

按 transport 分两种,但**契约完全一样**(都是 `send` 进、`Turn` 出):

- **remote agent**(`defineAgent`)—— 你在 `send` 里直接驱动:进程内调你的函数,或按你服务的协议发 HTTP。
- **sandbox agent**(`defineSandboxAgent`)—— 在沙箱里 spawn 一个 coding agent 的 CLI,跑完读回 transcript。

## 这组文档怎么分

| 文档 | 回答什么问题 |
|---|---|
| [Adapter 契约](contract.md) | **规范参考**:Agent / Turn / 事件流的精确形状;逐 `t` API 的适配义务——eval 调 `t.respond` / `t.newSession` / `t.notCalledTool`…时,adapter 必须返回什么、违约怎么暴露 |
| [Adapter 写法](authoring.md) | **怎么做出来**:分档递进(T0 收发 → T1 事件流 → T2 会话 → HITL → T3 tracing)、remote / sandbox 参考实现、采集层技巧、`shared` 工具袋 |
| [采集设计](collection.md) | **从哪采、字段从哪来**:三条外部路线对比、双轨四通道、claude-code / codex / bub / AI SDK 的采集矩阵、接新对象的决策树 |
| [Coding Agent Skills / Plugins DX](coding-agent-skills-plugins.md) | 沙箱型 coding agent 怎么安装 skill / plugin,并组织 A/B 实验 |
| [OTel mixin 提案](otel-mixin.md) | **设计提案**:被测应用已接 OTel 时,T1 事件流从 spans 派生、免写转换器——问题(转换器维护乘法)、DX before/after、机制与边界 |
| [agent-eval 参考](reference/agent-eval.md) | Vercel agent-eval 怎么做同一件事的源码阅读记录——学习资料,不是 niceeval 的实现 |
| [OTel GenAI 等标准参考](reference/otel-genai.md) | "agent 行为怎么记"的行业标准调研:OTel GenAI semconv 对比 agent-eval 自定义方案,附 OpenInference / OpenLLMetry / OpenAI Agents SDK / AG-UI / Langfuse |
| [agent loop 接入面](reference/agent-loop-apis.md) | 四个主流 agent loop(OpenAI Agents SDK / Claude Agent SDK / LangGraph / pi)的原生 API / 会话 / HITL / 遥测面调研 |
| [OTel 埋点生态](reference/otel-instrumentation.md) | 应用侧现成埋点(AI SDK telemetry / OpenLLMetry / OpenInference / 官方 contrib)里到底有没有 eval 要的数据 |
| [eve 协议机制](reference/eve-protocol.md) | 第三条路线:自有运行时原生吐协议(`HandleMessageStreamEvent` 26 种事件、三级坐标、requestId 回答)——`StreamEvent` 演进的上限参照 |

## 为什么是 experiment 选 agent,不是 `--url`

eve 能用一个 url 当被测对象,是因为它**定义了一套自己的协议**、被测 agent 恰好会说——于是"连哪"退化成"哪个 url"。niceeval 没有这个前提:不存在一套通用协议让任意 agent 都会说。所以:

- **没有 `--url`、没有通用的 "http agent"。** 要连你的 HTTP 服务,你写一个 agent,它内部知道你服务的协议(URL、鉴权、消息格式都是它的私事)。
- **agent 写进 experiment。** "评本地 vs 评线上"靠 agent 自己读 env,或写成两个 experiment / 两个 agent 配置:

```sh
npx niceeval exp local weather   # 评本地
npx niceeval exp prod weather    # 评线上
```

## Agent × Sandbox 正交

```text
experiment.agent    选「连哪个被测对象」(自实现的 adapter)
--sandbox <backend> 选「沙箱型 agent 在哪跑」(docker / vercel / 三方)
```

任意沙箱型 agent × 任意 sandbox 后端自由组合:`claude-code` 可跑 docker 也可跑 vercel;同一个 docker 沙箱可跑 `claude-code` 也可跑 `bub`。运行器按 experiment / `--sandbox` 备好 `Sandbox` 交给 `ctx.sandbox`,二者只通过 `Sandbox` 接口交互。remote agent 忽略 sandbox。详见 [Sandbox](../sandbox.md)。

## 相关阅读

- [Observability](../observability.md) —— transcript → 标准事件流的归一化、o11y、用量。
- [Scoring](../scoring.md) / [Assertions](../assertions.md) —— 这套事件流之上的全部断言。
- [Vision](../vision.md) —— 为什么名字只能用于路由、为什么没有通用协议。
