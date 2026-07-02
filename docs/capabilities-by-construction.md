# Capabilities by Construction —— 设计提案(未实现):能力由实现证明,声明只留给证明不了的

> 状态:设计提案,未实现。动机来自一个正确的质疑:「为什么能力是布尔变量,而不是实现了某个函数就算有?」本篇回答哪些位可以改成由实现证明、哪些逻辑上不可能、以及配套的默认值翻转。

## 现状的两个毛病

1. **双重声明。** tracing 已经有函数面(`tracing: { env / configure }` 块),但还要同时写 `capabilities: { tracing: true }`——同一件事说两遍,漏一半就出 bug(块写了、位没开 → receiver 不起,span 悄悄丢)。
2. **默认值替作者许诺。** `defineAgent` 默认 `conversation: true, toolObservability: true`(`src/define.ts` 的 `REMOTE_DEFAULT_CAPS`)。能力位的语义是诚实承诺,默认为真等于替作者许了没许过的诺——教程第一步不得不教人先写一行反悔:

```ts
// 今天的最小接入:第一行代码是为默认值擦屁股
export default defineAgent({
  name: "my-bot",
  capabilities: { conversation: false, toolObservability: false },  // ← 这行不该存在
  async send(input, ctx) { /* ... */ },
});
```

## 先分类:每一位的可证明性

判据:**证据在谁手里**。

| 位 | 证据在哪 | 能否由实现证明 |
|---|---|---|
| `sandbox` / `workspace` | 你用了哪个构造函数 | ✅ 构造即证明(`defineSandboxAgent` 本身) |
| `tracing`(沙箱型) | `tracing` 块的函数 | ✅ 块存在即证明 |
| `tracing`(远程型) | send 内部读 `ctx.telemetry` | ⚠️ 无独立函数面;mixin 落地后 `events: otelEvents()` 存在即证明 |
| HITL | send 返回 `waiting` + `input.requested` | ✅ 已经是行为证明,无位(现状即模范) |
| `toolObservability` | events 与「agent 实际做了什么」的关系 | ⚠️ 包装器证明不了完整性;**认证来源**可以(见下) |
| `compactionObservability` | 同上 | ⚠️ 同上,认证来源可以 |
| `conversation` | 对端服务是否真的续接 | ❌ 连 adapter 自己都证明不了(`previousResponseId` 发了,对端理不理是对端的事) |

关于「装饰器」:TypeScript 装饰器只能用在 class 成员上,`defineAgent` 是对象字面量,语法上用不了。但装饰器想表达的「在具体函数上盖章」有两个等价物:高阶函数包装、以及更干净的——**转换器的返回值本身就是章**(下节)。

## 三层方案

### 第一层:presence 推断——函数在,位就在

- `tracing` 块存在 ⇒ `tracing` 能力开。删掉双重声明:

```ts
// before:两处
capabilities: { ...,  tracing: true },
tracing: { protocol: "http/json", configure },

// after:一处,块即能力
tracing: { protocol: "http/json", configure },
```

- `defineSandboxAgent` 构造 ⇒ `sandbox` + `workspace` 开(现状靠默认值,语义改成「构造即证明」,效果一致、解释变直)。
- 远程 agent 的 tracing 过渡期保留显式声明;[otel-mixin](adapters/otel-mixin.md) 落地后,`events: otelEvents()` 存在 ⇒ `tracing` 开(它的数据源就是 spans,函数面天然存在)。

### 第二层:认证来源——转换器的返回值自带证明

包装器验证不了「events 是全量」,因为它看不见 agent 在现实里还做了什么。但**当来源本身有完整性契约时,消费这个来源的转换器可以携带证明**:

- `fromAiSdk(result)`:AI SDK 的 `result.steps` 就是工具循环的全量记录——SDK 契约保证,不是 adapter 自觉;
- `shared.parseClaudeCode / parseCodex / parseBub`:transcript 是 CLI 为自己 resume 写的全量侧写,天然完整;
- 反例:`otelEvents()` **不带** `toolObservability` 证明——埋点可能只盖了 LLM 层没盖工具层,mixin 提案已明确这一条,保持一致。

机制:转换器的返回值带一个非枚举的证明标记(Symbol 字段,JSON 序列化不带走):

```ts
// fromAiSdk 内部
return certify({ events, usage, status }, { toolObservability: true });
```

runner 按 attempt 聚合:**每一轮的 events 都来自带证明的来源** ⇒ 该 attempt 的负断言可信,等效于声明了 `toolObservability`;中途混入手工 events ⇒ 证明降档 + warning(与 [contract.md 行为守卫](adapters/contract.md)同一暴露方式)。

用户侧 DX:什么都不用写,用了官方转换器就自动有——

```ts
export default defineAgent({
  name: "my-ai-sdk-agent",
  async send(input, ctx) {
    const result = await generateText({ model, tools, prompt: input.text });
    return { ...fromAiSdk(result), data: result.text };
    // ↑ 返回值自带 toolObservability 证明,不写能力位,负断言照样可信
  },
});
```

`compactionObservability` 同理由 parser 携带(parser 见到 compaction 记录就吐事件,契约由 parser 保证)。

### 第三层:显式声明兜底——只留给证明不了的,且默认翻转为 false

- **手工映射的 `toolObservability`**:完整性取决于你的 API 返回里有没有全部调用,只有作者知道 → 保留声明。
- **`conversation`**:对端是否真续接,任何一层都证明不了 → 保留声明。(可以考虑给两种常见写法配薄包装器消灭「忘写回 id」这类机械错误,但那 5 行本来就短,不值得新 API;记为不做。)
- **默认全 false**:未证明 + 未声明 = 没有。内置工厂各自显式声明自己做到的。教程第一步变成:

```ts
// 提案后的最小接入:不声明 = 不承诺,零心智负担
export default defineAgent({
  name: "my-bot",
  async send(input, ctx) { /* ... */ },
});
```

### 优先级规则

三层叠加时:**显式声明 > 推断/证明**——作者永远可以显式关掉(比如用了 `fromAiSdk` 但明知自己在外面漏了一类工具调用)。显式开一个证明不了的位仍然允许(这就是今天的诚实声明),后果自负,契约的负断言完整性规则不变。

## 判决表:提案后每一位从哪来

| 位 | 来源 | 用户要写什么 |
|---|---|---|
| `sandbox` / `workspace` | `defineSandboxAgent` 构造 | 无 |
| `tracing` | `tracing` 块 / `events: otelEvents()` 存在 | 无(块本来就要写) |
| `toolObservability` | 认证来源推断;手工映射时显式声明 | 官方转换器:无;手工:一行声明 |
| `compactionObservability` | 认证来源(parser)推断 | 无 |
| `conversation` | 显式声明(默认 false) | 做到了写一行 |
| HITL | 行为(`waiting` + `input.requested`) | 无(现状) |

## 边界与未决

- **breaking change**:默认值翻转 + `capabilities.tracing` 退役要跟一个 major;旧写法(显式 `tracing: true`)过渡期兼容并 warning。
- **`workspace` 对远程 agent**:远程 agent 理论上也可能改文件,但 workspace 断言依赖 sandbox 提供 diff 基线,暂不放开,维持「构造即证明」。
- **证明标记的序列化**:Symbol 字段不进 results.json;view / 报表若要展示「本次运行能力从何而来」,在 attempt 元数据里落一个 `capabilitiesEvidence` 摘要,另议。
- **`t.newSession()` 在 conversation 未声明时**:现状允许调用(每 session 各自独立第一轮也有意义);默认翻转后行为不变,只影响「隔离断言可信度」的文档口径。

## 相关阅读

- [adapters/contract.md](adapters/contract.md) —— 能力位的诚实语义与负断言完整性规则(本提案不改变规则,只改变「谁来给出承诺」)。
- [adapters/otel-mixin.md](adapters/otel-mixin.md) —— `events: otelEvents()`:presence 推断在远程 tracing 上的形态;以及为什么它刻意不推 `toolObservability`。
- docs-site [能力位参考](../docs-site/zh/reference/capabilities.mdx) —— 面向用户的现状解释(「为什么是声明不是函数」);本提案落地后要改写。
