# custom-genai(自己埋 GenAI 语义约定)× niceeval

> **配对已过期**:这个例子原本在 `examples/zh/origin/custom-genai` 的基础上接入
> niceeval,应用代码逐字节相同。那个目录后来已经改名/重写为
> [`examples/zh/origin/pi-sdk`](../../origin/pi-sdk/)(真实 pi agent demo,不再手写
> OTel 埋点),不再是这个例子的 before 基线——下面这段描述保留的是这个目录**自己**
> 的应用代码(仍是手写 OTel 埋点),但它已经不对应任何 `zh/origin/` 下的 before 目录,
> 这组 before/after 配对待重做(同 `langgraph` 那批,见 `examples/README.md`)。

这个目录自己是一个不用任何 vendor SDK(没有 `@ai-sdk/otel`、`@traceloop/node-server-sdk`、
OpenInference)、直接用 `@opentelemetry/api` 手写 span、按
[OTel GenAI 语义约定](https://opentelemetry.io/docs/specs/semconv/gen-ai/)打属性的最小聊天
app,接了 niceeval 的接线。niceeval 只出现在新增的几个文件里:

- `agents/custom-genai.ts`——适配器。`send()` 把 `server.ts` 当子进程懒启动(第一次 send
  才 spawn,起来后跨 eval 复用同一个实例),对 `POST /api/chat` 发 `fetch`,把
  `{ reply, toolCalls }` 映射成 niceeval 的标准 `StreamEvent[]`(每个 toolCall 拆成
  `action.called` + `action.result` 一对)。
- `niceeval.config.ts` / `experiments/custom-genai.ts` / `evals/*.eval.ts`——标准 niceeval
  接线,风格对齐 [`examples/zh/eval/ai-sdk-v7`](../ai-sdk-v7/)。

只声明了 `capabilities: { toolObservability: true }`,没有 `conversation`:`server.ts` 的
`POST /api/chat` 虽然在 body 类型里收了 `sessionId`,但从来没把它传给 `runAgent`(只传了
`message`)——这个 app 事实上是单轮的,声明 `conversation` 会让 `t.reply` / `t.newSession`
这类断言看起来能用、实际上每次都是全新会话,负断言不可信,所以没声明。

## 目录结构

- `tracing.ts`:OTel 初始化(`NodeTracerProvider` + `SimpleSpanProcessor`,导出走
  `OTEL_EXPORTER_OTLP_ENDPOINT`)和两个埋点 helper:
  - `traceChatCall(model, input, fn)`——span 名 `chat {model}`,打
    `gen_ai.operation.name = "chat"`、`gen_ai.request.model`。
  - `traceToolCall(toolName, callId, args, fn)`——span 名 `execute_tool {tool}`,打
    `gen_ai.operation.name = "execute_tool"`、`gen_ai.tool.name`、`gen_ai.tool.call.id`、
    `gen_ai.tool.call.arguments`。
  两个 helper 都会在异常时 `recordException` + 把 span status 设成 ERROR。
- `tools.ts`:两个工具的真实实现:`get_weather(city)`(mock 数据,不打真实天气 API)、
  `calculate(expression)`(白名单正则 + `Function` 的安全算术求值),以及按名字分发调用
  的 `executeTool`。
- `agent.ts`:真实模型 + 手写 tool-calling 循环。`runAgent(message)` 用 `openai` npm
  SDK 打 OpenAI 兼容 API,每一轮模型调用和工具调用都经 `traceChatCall` / `traceToolCall`
  埋点,循环上限 5 轮。
- `server.ts`:一个 `node:http` 服务器,只负责 HTTP 层——`/healthz`、`/api/chat`(调
  `runAgent`)、`/`(静态首页)。
- `public/index.html`:单文件前端,原生 JS `fetch()`,没有构建步骤。
- `docker-compose.yml`:起一个 Jaeger,本地看 span 树用。

## 两种 span 的属性形状

模型调用(`chat {model}`):

```
gen_ai.operation.name = "chat"
gen_ai.request.model  = "gpt-4o-mini"
gen_ai.input.messages  = [...]   # 只有开了内容采集才有
gen_ai.output.messages = [...]   # 只有开了内容采集才有
```

工具调用(`execute_tool {tool}`):

```
gen_ai.operation.name    = "execute_tool"
gen_ai.tool.name         = "get_weather"
gen_ai.tool.call.id      = "call_..."
gen_ai.tool.call.arguments = "{\"city\":\"北京\"}"
```

**消息内容是 opt-in**:OTel 官方 instrumentation 出于隐私考量,默认不采模型输入输出的
原文。这个例子里由 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` 控制(见
`.env.example`),关着的时候 `gen_ai.input.messages` / `gen_ai.output.messages` 这两个
属性根本不会出现在 span 上——如果你的断言依赖消息内容(比如 niceeval 的
`messageIncludes`),记得打开这个开关。

## 跑起来

这个目录是一个**独立的 npm 项目**(自带 `package.json`,`niceeval` 以 link 方式指向仓库根)。

```sh
cd examples/zh/eval/custom-genai
pnpm install
cp .env.example .env
# 在 .env 里填 OPENAI_API_KEY(可选 OPENAI_BASE_URL / AGENT_MODEL,接 DeepSeek 等
# OpenAI 兼容服务时用),需要的话再填 NICEEVAL_JUDGE_BASE/KEY(见下面「judge 走哪」)
pnpm dev               # 手动跑网页版,监听 5299
pnpm run eval           # 跑 niceeval:懒启动同一个 server.ts,真的调模型
```

浏览器打开 `http://localhost:5299`,问「北京天气怎么样」或者「(3+4)*2 等于多少」,能看到
回复里带工具调用记录。

### judge 走哪

`t.judge.autoevals.closedQA(...)` 内部用 autoevals(braintrust)库,固定用
`tool_choice` 强制指定一个打分函数。这个 app 的 `.env` 里 `OPENAI_BASE_URL` 直连
`api.deepseek.com`——这个端点对 `deepseek-v4-flash` / `deepseek-v4-pro` 两个模型在带
`tool_choice` 时都会报 `Thinking mode does not support this tool_choice`(用 curl 直接
打这个端点复现过,不是 niceeval 或这个 adapter 的 bug)。所以 `niceeval.config.ts` 里
`judge.model` 钉 `gpt-5.4`,`.env` 里另配一对 `NICEEVAL_JUDGE_BASE` / `NICEEVAL_JUDGE_KEY`
把 judge 单独指到一个支持普通 function calling 的网关——judge 模型本来就该跟被测 agent
的模型/网关分开,这不是额外的负担。

看 span 树:

```sh
docker compose up -d          # 起 Jaeger,OTLP HTTP 端口 4318
# .env 里设 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces,重启 pnpm dev
open http://localhost:16686   # Jaeger UI,选 custom-genai-example 服务看 span
```

在 Jaeger 里能直接看到 `chat {model}`(比如 `chat gpt-4o-mini`)套着 `execute_tool get_weather`
这类父子结构,
以及每个 span 上的 `gen_ai.*` 属性——如果你要给自己的 agent 手写埋点,这就是能直接照抄的
形状。

## 相关文档

这个示例把 [接 OTel 观测](../../../../docs-site/zh/guides/connect-otel.mdx) 文档「2. 应用侧」
里「自己埋的 gen_ai」那个 tab 展开成完整可跑的 app,也是自定义埋点想对齐 GenAI semconv 时
能直接抄的参考实现。

`agents/custom-genai.ts` 这种「子进程起服务 + fetch 打 HTTP 接口」的适配器写法,对应
[Connect your agent to niceeval](../../../../docs-site/guides/remote-agent.mdx) 里的
"Deployed agent" 模式。
