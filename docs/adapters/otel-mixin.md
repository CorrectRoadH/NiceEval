# OTel mixin(设计提案)—— 已埋点应用免写事件映射

**状态:设计提案,未实现。** 依据两篇调研:[agent-loop-apis.md](reference/agent-loop-apis.md)(四个主流 loop 的原生 API 面)和 [otel-instrumentation.md](reference/otel-instrumentation.md)(应用侧埋点里有什么数据)。

## 问题:T1 是五档里最贵的一档,而且是乘法

adapter 的档位阶梯(见 [authoring.md](authoring.md))里,T0 十行、T2 几行透传、HITL 两条行为,唯独 **T1 事件流是真功夫**:把框架的原始返回完整映射成 `StreamEvent[]`,callId 配对、时序保真、负断言完整性。内建 `fromAiSdk`(`src/agents/ai-sdk.ts`)530 行是个诚实的样本,拆开看:

| 构成 | 大约行数 | 性质 |
|---|---|---|
| 形状子集类型(v4/v5/v7 字段漂移) | ~120 | **版本乘法**:同一框架三个大版本三套字段名 |
| content parts / step 字段 → 事件翻译 | ~140 | T1 本体 |
| v7 approval + responseMessages 挖掘 | ~90 | HITL 特有形状 |
| usage 归一 + 工具名映射 | ~60 | T1 配套 |
| `aiSdkAgent` 工厂(会话 / 裁决翻译 / 兜底) | ~120 | T2 + HITL 托管 |

所以「几百行」不说明契约难——**T0 接入始终是十行**;它说明的是:每支持一个框架,就要为它的私有返回形状维护一份高质量转换器,并跟着它的版本漂移走。[agent-loop-apis.md](reference/agent-loop-apis.md) 的结论正是:OpenAI Agents SDK / Claude Agent SDK / LangGraph / pi 每家的原语都能机械映射到 niceeval 契约,**难点不在语义,在 N 家 × 版本的维护乘法**。`fromAiSdk` 这条"每框架一个精品转换器"的路线只对最高频的框架划算。

## 机会:被测应用越来越多地已经会说 OTel

三个调研事实叠起来:

1. **内容默认在。** AI SDK `experimental_telemetry` / OpenLLMetry / OpenInference 三大埋点生态,工具名、入参、出参、消息文本、token **默认全采**(opt-out);只有 OTel 官方 instrumentation 是 opt-in([otel-instrumentation.md](reference/otel-instrumentation.md) 的核心矩阵)。
2. **出口是标准的。** 不管应用用哪家埋点,导出都是 OTLP/HTTP,`OTEL_EXPORTER_OTLP_ENDPOINT` 一个 env 就能改道;LangGraph 甚至有零依赖路线(`LANGSMITH_OTEL_ENABLED` 三个 env)。
3. **接收管道我们已经有了。** `src/o11y/otlp/receiver.ts`(进程内 OTLP/HTTP 接收,JSON + protobuf + gzip)和 canonical mapper 结构(每方言一个薄 mapper)就是 T3 的基础设施——mixin 缺的只是两层:**span → `StreamEvent[]` 派生**和 **turn 归属**。

也就是说:对已埋点的应用,T1 需要的数据已经以标准协议送到我们门口了,只是今天只被用来画瀑布图(T3),没有喂给断言(T1)。

## DX:before / after

场景:用户有一个 LangGraph 写的客服 bot,跑在自己的服务里,已经按 LangSmith 文档开了 OTel。他想评它。

**Before(今天):** 要么读 LangGraph 的 messages 结构手写映射,要么放弃 T1 只做 T0:

```typescript
// agents/support-bot.ts —— 今天:手写 toStreamEvents,~60 行起步
export default defineAgent({
  name: "support-bot",
  async send(input, ctx) {
    const r = await fetch(`${BOT_URL}/chat`, { method: "POST", body: JSON.stringify({ message: input.text }), signal: ctx.signal });
    const body = await r.json();
    return { events: toStreamEvents(body), data: body, status: "completed" };
  },
});

function toStreamEvents(body: SupportBotResponse): StreamEvent[] {
  // 逐条翻译 AIMessage.tool_calls / ToolMessage.tool_call_id / content …
  // 服务返回里还得先把这些透出来 —— 应用侧也要改
}
```

**After(提案):** 事件从本轮收到的 spans 派生,`send` 只管收发;应用侧只改环境变量:

```typescript
// agents/support-bot.ts —— 提案:事件来源声明为 OTel
import { defineAgent, otelEvents } from "niceeval/adapter";

export default defineAgent({
  name: "support-bot",
  capabilities: { conversation: true, toolObservability: true, tracing: true },
  events: otelEvents(),          // ← T1 事件流 + T3 trace 都从本轮 spans 来
  async send(input, ctx) {
    const r = await fetch(`${BOT_URL}/chat`, { method: "POST", body: JSON.stringify({ message: input.text }), signal: ctx.signal });
    return { data: await r.json(), status: "completed" };   // 不写 events
  },
});
```

```sh
# 被测服务侧(LangGraph 零依赖路线,详见 otel-instrumentation.md)
LANGSMITH_TRACING=true LANGSMITH_OTEL_ENABLED=true LANGSMITH_OTEL_ONLY=true \
OTEL_EXPORTER_OTLP_ENDPOINT=$NICEEVAL_OTLP_ENDPOINT node server.js
```

eval 侧什么都不用变——`t.calledTool("lookup_order", { input: { orderId: "42" } })`、`toolOrder`、`noFailedActions`、`maxTokens` 照写,现在有数据了。trace 瀑布图(T3)顺手就有,因为数据源是同一批 span。

`otelEvents()` 的配置面刻意小:

```typescript
events: otelEvents({
  dialects: "auto",            // 默认:按 span 属性自动识别 ai.* / gen_ai / OpenInference / OpenLLMetry
  messages: true,              // 默认:埋点里有消息文本就派生 message 事件
})
```

## 机制

### span → StreamEvent 派生(纯函数,方言表)

`deriveEventsFromSpans(spans): StreamEvent[]`,与 parser 同一纪律(纯数据变换、可独立单测)。每方言一个薄解析器,识别信号与字段:

| 方言 | 识别信号 | action.called/result | message | usage |
|---|---|---|---|---|
| AI SDK `ai.*` | `operation.name: "ai.toolCall"` 等 | `ai.toolCall.name/.id/.args/.result` | `ai.response.text` | `gen_ai.usage.*`(doGenerate span) |
| gen_ai semconv | `gen_ai.operation.name: "execute_tool"` | `gen_ai.tool.name/.call.id/.call.arguments/.call.result` | `gen_ai.output.messages`(opt-in) | `gen_ai.usage.*` |
| OpenInference | `openinference.span.kind: "TOOL"/"LLM"` | `tool.name` + `input.value`/`output.value`、`tool_call.id` | `llm.output_messages` | `llm.token_count.*` |
| OpenLLMetry | `gen_ai.prompt.{i}.*` 索引式属性 | `…tool_calls.{j}.id/.name/.arguments` | `gen_ai.completion.{i}.content` | `gen_ai.usage.*` |

派生规则:

- **callId** 用方言里的显式 tool call id(四套全有,见调研);span 无 result 属性时,tool span 的 `status`(OK/ERROR)定 `action.result.status`。
- **时序**从 span `startTime` 排序恢复——比事件流转换器还多一层保底(span 自带时间戳,`eventOrder` 天然成立);同刻并列按父子关系。
- **usage** 只从 model 类 span(`chat` / doGenerate)聚合,防止父子 span 重复计数;顺手填 `Turn.usage`,`maxTokens` / `maxCost` 解锁。
- 这层复用 canonical mapper 的成果:先 `heuristicTag` 认出 span 角色,再按方言抠字段——「span 语义识别」不重写第二份。

### turn 归属

spans 是异步推来的,必须知道「这批 span 属于哪一轮 send」:

- **窗口法(第一版):** runner 在 `send` 前记时间戳,`send` 返回后 `receiver.settle()`(已有),取窗口内收到的 span。要求 receiver **per-attempt**(今天 tracing receiver 是 per-sandbox;remote agent 加 mixin 后同样 per-attempt 起一个,端口成本可忽略)——同一 attempt 内轮与轮靠窗口切,attempt 之间靠独立端口隔离,并发跑不串。
- **traceparent 法(第二版):** `ctx.telemetry` 加 `headers`(W3C `traceparent`),HTTP adapter 随请求带上;支持 context 传播的埋点(Claude Code 的 `TRACEPARENT`、LangSmith 检测 global provider)会把本轮 span 挂到我们给的 trace 下,归属从「按时间猜」变「按 id 定」。窗口法仍是兜底。

### 能力位语义(诚实声明规则不变)

`otelEvents()` **不自动打开** `toolObservability`——完整性承诺只有用户能做(埋点是否覆盖了应用的全部工具层,niceeval 无法自证)。配套两条守卫(沿用 [contract.md 第三层](contract.md#第三层行为守卫声明了但没做到--机检的报错机检不了的警告)的形状):

- 声明了 `events: otelEvents()` + `toolObservability`,整轮 **0 span** → warning(端点没接上,比漏埋更常见);
- 派生出的 `action.called` 大面积无配对 result → warning(埋点只盖了 LLM 层没盖工具层的典型症状)。

## 边界(哪些不归 mixin)

- **T2 / HITL 仍是 `send` 的活。** spans 没有「等人输入」语义,会话续接也是应用协议的事——mixin 只覆盖 T1 + T3。这不是缺陷:调研显示这两档在各框架里本来就是几行透传([agent-loop-apis.md 启发 2、3](reference/agent-loop-apis.md#对-niceeval-的印证与启发))。
- **消息文本看埋点。** 三方生态默认有;OTel 官方埋点要用户开 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`,不开则 `messageIncludes` 无数据(正断言会响,不静默)。文档要写清各生态怎么开。
- **负断言完整性依旧靠纪律。** mixin 把「写转换器」的成本降为零,但「埋点完整」的责任转到了应用侧——文档必须把这条从 adapter 作者的义务改写成应用作者的义务。
- **与 per-framework 转换器不互斥。** `fromAiSdk` / `aiSdkAgent` 这种精品路线保留给最高频框架(进程内、有 HITL、要 v4→v7 兜底);mixin 是长尾路线——黑盒服务、一次性接入、niceeval 没有(也不该有)专属转换器的框架。两条路的取舍写进 [collection.md](collection.md) 的决策树。

## 落地顺序

1. `deriveEventsFromSpans` 纯函数 + 方言表(`src/o11y/otlp/derive-events.ts`),fixtures 用真实导出抓取,独立单测——不动 runner 就能验证四套方言。
2. per-attempt receiver + send 窗口标记(runner 改动最小的一版;remote agent 声明 `tracing` 即起 receiver)。
3. `events: otelEvents()` 接线:派生结果与 adapter 自己的 `events` 按时间戳合并,0-span / 无配对 warning。
4. `ctx.telemetry.headers`(traceparent)+ 文档 + 一个 LangGraph 黑盒服务 example。

## 相关阅读

- [agent-loop-apis.md](reference/agent-loop-apis.md) / [otel-instrumentation.md](reference/otel-instrumentation.md) —— 本提案的证据链。
- [contract.md](contract.md) —— 能力位承诺与行为守卫(mixin 沿用同一套暴露方式)。
- [observability.md](../observability.md) —— 双轨设计;mixin 让两轨在「已埋点应用」上共享同一数据源。
