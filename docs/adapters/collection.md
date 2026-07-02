# 采集设计 —— 通道、矩阵与每个被测对象怎么接

这一篇集中回答:**每个被测对象,行为数据和 trace 从哪条路径采、哪些字段从哪里来。**

分工:[Adapter 契约](contract.md) 定义采集的**目标**(`StreamEvent` / `Turn` 长什么样、每条断言要什么数据);[Adapter 写法 · 采集层](authoring.md#采集层原始数据怎么从-agent-cli-弄到手) 讲通用**纪律**(采集脏 / 转换净、raw string 边界、行级容错);本篇是**具体矩阵**——三条外部路线的对比结论、niceeval 的通道设计、以及 claude-code / codex / bub / AI SDK 各自的字段来源(与 `src/o11y/parsers/` 和 `src/agents/` 现状对齐)。接一个新被测对象时,从[决策树](#接新被测对象的决策树)进。

## 三条外部路线:采集路径与字段的取舍

[reference/](README.md#这组文档怎么分) 三篇调研收拢成一张表,核心结论:**采集路径决定字段上限**——你从哪拿数据,决定了你最多能知道什么。

| 路线 | 采集路径 | 字段上限 | 前提 | 代价 |
|---|---|---|---|---|
| [eve](reference/eve-protocol.md) | **无采集**——运行时原生吐协议(NDJSON over HTTP,带版本号) | 最高:26 种事件、`sequence/turnId/stepIndex` 坐标、per-step usage、`RuntimeIdentity` 自报模型 | **拥有运行时** | 只能评自己 |
| [agent-eval](reference/agent-eval.md) | 磁盘旁读(claude-code)+ stdout 捕获(codex),另开第二通道读磁盘抠实际模型;无 trace | 最小公分母:5 种事件、无 callId(顺序配对)、丢 turn/step 边界 | 无(逆向黑盒) | 每个 CLI 一堆 hack,并发配对会错 |
| [OTel GenAI](reference/otel-genai.md) | OTLP 网络推送(agent 自己 instrument) | span 树带时间与层级;但消息内容 / 工具入参 **opt-in**,常缺 | agent 愿意发、发得对 | 断言最需要的内容字段恰恰不保证有 |

## niceeval 的设计:双轨 × 四通道

行为和时间分两轨,各自选通道;一个 agent 可以多通道并用,按"这份数据用来干什么"分别决定怎么采(agent-eval 的 codex 双通道教训):

```text
行为轨(StreamEvent[] —— 断言的唯一数据源,必须全量)
  通道 0 · 进程内直构   remote agent:send 里直接把返回映射成事件,零采集(eve 式,保真上限)
  通道 1 · 磁盘旁读     CLI 为自己 resume 写的侧写文件(claude-code transcript、bub tape)
  通道 2 · stdout 捕获  CLI 的结构化输出 flag(codex --json)
       ↘ 通道 1/2 统一收窄成 raw string → o11y/parsers/<agent>.ts(纯函数,可单测)

时间轨(TraceSpan[] —— 瀑布图,允许缺)
  通道 3 · OTLP 推送    agent 经 OpenTelemetry 推给运行器的本机接收器
                        → o11y/otlp/mappers/<agent>.ts 归一 canonical GenAI semconv
                        没有 OTel 输出的(claude-code)从 transcript 时间戳合成 span
```

两轨的容错要求不同,这是设计的关键不对称:**行为轨缺数据是契约问题**(负断言静默假通过,见[契约 · 负断言完整性规则](contract.md#负断言的完整性规则)),做不到就显式关能力位;**时间轨缺数据是降级**(view 少画一张瀑布图,断言不受影响)。

## 采集矩阵:现状(与 `src/` 对齐)

每行都是"这个字段从原始数据的哪里抠"——写新 parser 时照这个粒度补一行:

| | claude-code | codex | bub |
|---|---|---|---|
| **行为轨通道** | 磁盘旁读 | stdout 捕获 | 磁盘旁读(tape) |
| **原始位置** | `~/.claude/projects/<slug>/` 最新 `.jsonl`(`shared.captureLatestJsonl`) | `codex exec --json` 的 stdout(`shared.extractJsonlFromStdout`) | `~/.bub/tapes/<md5(ws)__md5(sess)>.jsonl` |
| **行形状** | `{ type: "user"\|"assistant", message: { content: [...], usage } }`,content 混 text / tool_use / thinking 块 | 生命周期事件(`thread.*` / `turn.*` / `item.*` / `response.*`) | `{ kind: message\|tool_call\|event\|anchor, payload }` |
| **callId 配对** | `tool_use.id` ↔ user 行里 `tool_result.tool_use_id`(显式,坑:工具结果包装成 user 消息) | `call_id` 显式 + FIFO 队列兜底(老式 `function_call_output` 无 id) | 与上一条 tool_call **按位对齐** + 合成 id 兜底 |
| **usage** | assistant 行 `message.usage`(含 cache read) | 防御式多路径:`data/payload/item/turn/response.usage`,兼容 `input/output_tokens` 与 `prompt/completion_tokens` 两套命名 | `event(name=="run")` 的 `data.usage`(`prompt/completion_tokens`,**`cost` 直接有**) |
| **session id(resume 用)** | transcript 首个 `sessionId` 字段(`shared.sessionIdFromClaudeTranscript`) | `thread.started.thread_id`(`shared.codexThreadId`) | tape 文件名含 session hash;adapter 自管 |
| **实际模型** | transcript 行内有 | 网关场景要第二通道读 `~/.codex/sessions` 的 `turn_context.payload.model`(agent-eval 的做法;niceeval 未接,记为已知缺口) | tape 内 run 事件 |
| **时间轨** | 无原生 OTel → transcript 时间戳合成 span | 原生 OTLP/JSON(`config.toml [otel]`,走 `tracing.configure`) | 原生 OTLP/protobuf(env-based `OTEL_*`,走 `tracing.env`) |

remote agent(通道 0)不在表里——它没有"采集",字段来源就是你自己代码里的返回值,见下节示例。

## 接入路线的优先级(提案):OTel 兼容优先

用户侧的建议顺序(docs-site 的接入导流已按此排):

1. **内置件**:AI SDK 应用用 `aiSdkAgent`,coding agent 用内置三个 sandbox agent;
2. **OTel 兼容**:被测应用已接(或愿意加几行配置接上)OpenTelemetry → `events: otelEvents()`,事件与 trace 同源派生(见 [otel-mixin](otel-mixin.md));
3. **官方转换器 / SDK 通道 0**:`fromAiSdk` 这类精品转换器,或官方 SDK 包装(Codex SDK / Cursor SDK,见 [targets.md](targets.md));
4. **手写映射**:以上都接不了的黑盒,`toStreamEvents` 兜底。

OTel 排在手写映射之前的理由:**维护乘法换边**——手写映射的成本是「N 个被测对象 × 各自的私有返回形状 × 版本漂移」,由 adapter 作者(我们和用户)背;OTel 路线的成本是「M 种埋点方言 × 归一规则」,埋点本身由 AI SDK / OpenLLMetry / LangSmith 们维护,M 远小于 N 且在收敛(AI SDK 官方新模式与 OpenClaw 已原生说 GenAI semconv,targets.md 的调研)。同一批 span 还同时喂 T1 断言和 T3 瀑布图,一次接入双份产出。

### 归一规则层:各家 OTel 怎么转成我们的目标格式

目标格式就两个,管线已有雏形:**时间轨** `TraceSpan` → canonical GenAI semconv(`o11y/otlp/mappers/`,`tagSpan` / `heuristicTag`);**行为轨** spans → `StreamEvent[]`(otel-mixin 提案的 `deriveEventsFromSpans`)。规则层的设计问题是:方言规则用什么形态定义?

- **备选 A:声明式映射表**(JSON / DSL:匹配条件 → 字段路径)。好处是不写代码、用户可配置;否掉的原因是方言差异远不止字段名——OpenLLMetry 是索引式属性(`gen_ai.prompt.{i}.*`)要循环重组,LangSmith 要从 span 名 + kind 组合推断,codex 甚至要从 log events 合成 span——表达力很快不够,DSL 会长成半个编程语言。
- **备选 B(推荐):每方言一个纯函数规则模块**,「规则的定义」体现在统一的模块契约上:

```ts
interface OtelDialect {
  name: string;
  detect(span: TraceSpan): boolean;          // 识别信号(如 openinference.span.kind 存在)
  toEvents(spans: TraceSpan[]): StreamEvent[]; // 行为轨派生(callId / 时序 / usage 纪律同 parser)
  tagSpan?(span: TraceSpan): SpanTag;        // 时间轨归一;缺省走通用 heuristicTag
}
```

共享三样,新方言零核心改动:识别信号的探测顺序表、canonical 词汇(`OP_CHAT` / `OP_EXECUTE_TOOL` / …)、`heuristicTag` 兜底。每个方言模块配真实导出抓取的 fixtures 单测——与 `o11y/parsers/` 同一纪律。用户扩展口:`events: otelEvents({ dialect: myDialect })` 接受自定义方言模块,core 仍不认识任何具体方言的名字(中立边界不破)。

规则层只管**翻译**,不管**承诺**:负断言完整性(埋点盖没盖全工具层)归应用侧声明,conversation / HITL 仍是 `send` 的活——这两条边界在 otel-mixin 提案里,规则层不重复解决。

## 接新被测对象的决策树

```text
被测应用已接(或愿意接)OpenTelemetry?
├─ 是 → OTel 兼容路线:events: otelEvents(),T1 + T3 同源(见 otel-mixin.md)
│       负断言要用户确认埋点覆盖后自行声明 toolObservability
└─ 否
   ├─ 你控制被测对象的运行时?(自己的 agent / 进程内函数)
   │    → 通道 0:send 里直构 StreamEvent,保真上限最高(eve 级),见下面 AI SDK 示例
   └─ 黑盒 CLI / 别人的服务
        ├─ 官方有 SDK 包装?(Codex SDK / Cursor SDK,见 targets.md)→ 当通道 0 接,别逆向 stdout/磁盘
        ├─ CLI 有结构化输出 flag(--json)?      → 通道 2:stdout 捕获
        ├─ 没有,但 CLI 为 resume 写侧写文件?    → 通道 1:磁盘旁读(找它的 session 目录)
        └─ 都没有                               → 老实做 T0:events 传 [],
                                                  显式关掉 toolObservability(别让负断言假通过)
trace 另算:CLI 会发 OTel?→ 写 tracing 块 + mapper;不会 → transcript 时间戳合成,或直接跳过
```

字段找不到时的取舍,有先例可循:

- **callId 缺失** → 按位 / FIFO 兜底(bub、codex 老格式的做法)——能用,但这是在赌"工具调用严格顺序",并发即错配;有显式 id 一定用显式 id。
- **usage 缺失** → 不填,**别编数字**。后果是 `maxTokens` / `maxCost` 假通过(见契约),这比错误的成本数据可接受。
- **实际模型拿不准**(网关改写)→ 学 agent-eval 开第二通道去磁盘 session 文件里读,别信请求参数。

### 通道 0 示例:AI SDK 直构(接自己的 agent)

AI SDK 的返回天生带显式 `toolCallId`、分 step、带 usage——映射几乎是逐字段抄写,这就是"控制运行时 = 保真上限"的含义。这层映射(含 v4/v5/v7 字段名漂移:`args`/`input`、`result`/`output`、`promptTokens`/`inputTokens`/`inputTokenDetails`)已收进 `fromAiSdk`(`niceeval/adapter` 导出,`src/agents/ai-sdk.ts`,结构化 typing、不依赖 `ai` 包)。

**大多数场景不用自己写 send**:内建工厂 `aiSdkAgent` 把通道 0 全托管——会话历史(`isNew` / resume)、HITL 裁决翻译、失败兜底都在工厂里,应用只写「怎么召模型」:

```typescript
// experiments/my-app.ts
import { aiSdkAgent } from "niceeval/adapter";
import { generateText, isStepCount, type ModelMessage } from "ai";

const agent = aiSdkAgent<ModelMessage>({
  name: "my-assistant",
  generate: ({ messages, model, signal }) =>
    generateText({ model: myModel(model), system: SYSTEM_PROMPT,
                   tools, stopWhen: isStepCount(5), messages, abortSignal: signal }),
  data: (result) => ({ reply: result.text }),
});
```

要更细的控制(比如 HTTP web agent、自定义会话存储)再手工组合 `defineAgent` + `fromAiSdk`:

```typescript
// agents/my-ai-sdk-agent.ts
import { defineAgent, fromAiSdk } from "niceeval/adapter";
import { generateText } from "ai";

export default defineAgent({
  name: "my-ai-sdk-agent",
  capabilities: { toolObservability: true },   // conversation 要自己攒 messages 才能声明
  async send(input, ctx) {
    const result = await generateText({
      model: myModel(ctx.model), tools, prompt: input.text, abortSignal: ctx.signal,
    });
    // steps 里带 toolCallId 的完整调用记录 + 全 step 聚合 usage + waiting/completed → 一行转完
    return { ...fromAiSdk(result), data: result.text };
  },
});
```

`fromAiSdk` 做的事,对照矩阵读:`toolCallId` 直接就是 `callId`(不需要兜底);v5+ 的 `step.content` parts 自带真实顺序(reasoning → tool-call → tool-result → text),时序保真;`tool-error` part 映射成 `status: "failed"` 的 `action.result`,喂 `noFailedActions()`;v7 tool approval(`needsApproval` 工具)的 `tool-approval-request` part 映射成 `input.requested` 事件 + 整轮 `status: "waiting"`,resume 后被拦工具的执行结果从 `responseMessages` 里补成 `action.result`(拒绝 = `rejected`,不是 `failed`)——HITL 契约的「waiting + input.requested」两条义务由转换器直接满足;usage 用 `totalUsage`(全 step 聚合)优先、v7 的 cache tokens 从 `inputTokenDetails` 读(eve 按 step 记的粒度这里是可得而未取,见 [eve 笔记 · 启发 3](reference/eve-protocol.md#对-niceeval-适配器设计的启发));时间轨可选接 AI SDK 的 `experimental_telemetry`(OTel spans → mapper,remote agent 也能有瀑布图)。完整可跑的版本:`examples/zh/ai-sdk-v7/`(内建 `aiSdkAgent`,AI SDK v7 + HITL 全档)与 `examples/zh/ai-sdk/`(自写 HTTP web agent:服务端 `fromAiSdk` 直构,adapter 透传)。

自有 HTTP 服务同理走通道 0:协议是服务的私事,但如果服务是你写的,**让它直接返回 `StreamEvent` 兼容的 JSON 是最省的适配**——`toStreamEvents` 退化成透传。

## 接新黑盒 CLI 的清单

以"接 gemini-cli / opencode / 下一个"为例,照矩阵补一列的活:

1. **选行为轨通道**:翻它的文档 / strace 找结构化输出 flag(通道 2);没有就找 `~/.<cli>/` 下的 session 侧写(通道 1)。
2. **写 parser**(`o11y/parsers/<name>.ts`):纯函数只吃 `raw: string`;逐行 try/catch;按[契约 · 事件流三条纪律](contract.md#标准事件流)产事件(时序、callId、双名字);usage 学 codex 的防御式多路径。
3. **抠 session id**:resume 要用;学 `shared.firstJsonField` 的通用兜底。
4. **时间轨**:CLI 有 OTel 配置就写 `tracing` 块 + mapper;没有先跳过(降级不崩)。
5. **对照矩阵自查字段**:callId 显式吗?usage 哪套命名?实际模型在哪?——每格都该能回答"从哪抠",答不上的格子显式记为缺口(像上表 codex 实际模型那格)。

## 相关阅读

- [Adapter 契约](contract.md) —— 采集的目标形状与逐断言数据义务。
- [Adapter 写法](authoring.md) —— 采集纪律、分档、shared 工具袋。
- [reference/](reference/agent-eval.md) —— 三条路线的原始调研(agent-eval / OTel GenAI / eve)。
- [Observability](../observability.md) —— parser 与 mapper 在 o11y 管线里的位置。
