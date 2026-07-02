# LangGraph / LangChain + LangSmith OTel 示例

这个示例演示 LangGraph 官方推荐的最小聊天应用形状(LangChain 1.x):

- **后端零服务器代码**:`src/agent.ts` 用 `createAgent`(`langchain` 包,内部就是
  一个编译好的 LangGraph 图)定义 agent 并 export,`langgraph.json` 指到这个导出,
  由 **Agent Server**(`langgraphjs dev`,`@langchain/langgraph-cli`)加载——线程
  管理、流式 API、checkpoint 全部由服务器提供,不再手写 `node:http` 路由。
- **前端用官方 hook**:`@langchain/react` 的 `useStream()` 直连 Agent Server
  (默认 `http://localhost:2024`),token 拼接、工具调用生命周期(参数/结果/状态)、
  线程续接全部由 hook 处理,不自己解析 SSE、不发明 `{reply, toolCalls}` 中间格式。

同时它把 [`docs-site/zh/guides/connect-otel.mdx`](../../../../docs-site/zh/guides/connect-otel.mdx)
"2. 应用侧" 一节里 **LangGraph / LangChain** tab 的 LangSmith OTel-only 导出配置摊开成
可跑的代码(`src/observability.ts`)。它是一个**普通的 LangGraph 应用**——不接
niceeval,没有 `adapter/`、`evals/`、`niceeval.config.ts`,单独一个 `package.json`,
和仓库根的 pnpm workspace 无关。

## 目录结构

- `langgraph.json`:Agent Server 的配置——`graphs.agent` 指向 `src/agent.ts` 的
  `agent` 导出,`env: ".env"` 让服务器启动时加载环境变量。
- `src/agent.ts`:`ChatOpenAI` + `createAgent`(LangChain 1.x 推荐写法,替代旧的
  `createReactAgent`)。不配 checkpointer——Agent Server 自己管线程持久化
  (dev 模式存内存,重启即丢)。
- `src/tools.ts`:两个工具的纯函数实现——`get_weather(city)`(固定城市表 + 未知
  城市按名字算确定性伪随机)和 `calculate(expression)`(不用 `eval()`/`Function()`
  的递归下降算术解析器)。同时导出包了 `tool()` + zod schema 的 LangChain 工具对象。
- `src/observability.ts`:LangSmith 的 OTel-only 导出接线(由 `src/agent.ts`
  import,随 graph 一起在 Agent Server 进程里加载),见下面「和文档 tab 的差异」。
- `src/client/App.tsx`:React 聊天页,`useStream({ apiUrl, assistantId, threadId,
  onThreadId })`,渲染 `stream.messages` / `stream.toolCalls`,`stream.stop()` 停止。
- `index.html` / `vite.config.ts`:Vite 开发入口(端口 5173)。
- `docker-compose.yml`:本地自托管的 trace 查看器(Jaeger),接收 OTLP/HTTP。

## 和文档 tab 的差异

文档 tab 说这是"零依赖路线,三个环境变量"。这句话对 **Python** 版 `langsmith` SDK
成立(import 时自动挂 OTel hook)。但当前 **JS** 版(`langsmith@0.7.x`)还没做到
纯 env 驱动:`@langchain/core` 的埋点靠全局 OTel `TracerProvider`,JS 没有 Python
那种导入期自动注册机制——不主动调用一次 `initializeOTEL()`,SDK 只会打一行警告、
不产生任何 span。所以 `src/observability.ts` 比文档 tab 多了这一行 `initializeOTEL()`
调用,其余(三个 `LANGSMITH_*` 变量 + 标准的 `OTEL_EXPORTER_OTLP_ENDPOINT`)完全
是纯 env 变量驱动,没有别的应用代码改动。这些变量只在进程启动时读一次(标准 OTel
SDK 的限制),改了 `.env` 要重启 `langgraphjs dev` 才生效,热切换端点做不到。

## 跑起来

这个目录是一个**独立的 npm 项目**(自带 `package.json` 和 `pnpm-workspace.yaml`)。

```sh
cd examples/zh/origin/langgraph
pnpm install
cp .env.example .env
```

```sh
# .env 里填 OPENAI_API_KEY(可选 OPENAI_BASE_URL / AGENT_MODEL)
pnpm dev
# server = Agent Server(langgraphjs dev,http://localhost:2024,本地免费跑,
#          不需要 LANGSMITH_API_KEY;API 文档在 http://localhost:2024/docs)
# web    = Vite(http://localhost:5173,浏览器打开这个地址聊天)
```

会话即线程:第一条消息发出后 Agent Server 自建 thread,`useStream` 的 `onThreadId`
把 id 交给前端保存,同一 thread 内多轮对话有记忆(dev 模式存内存,重启服务器就丢)。

看 trace(可选):

```sh
docker compose up -d
# .env 里取消注释 LANGSMITH_TRACING / LANGSMITH_OTEL_ENABLED / LANGSMITH_OTEL_ONLY
# / OTEL_EXPORTER_OTLP_ENDPOINT(默认已指向下面这个本地 Jaeger),重启 pnpm dev
open http://localhost:16686   # Jaeger UI,按 service 名筛 span
```

真要看 LangSmith 官方 UI(prompt/completion 内容、按 run 分组等),把 `.env` 里的
`OTEL_EXPORTER_OTLP_ENDPOINT` 换成 LangSmith 云端端点(`https://api.smith.langchain.com/otel/v1/traces`,
配 `OTEL_EXPORTER_OTLP_HEADERS="x-api-key=<你的 LangSmith key>"`)即可,应用代码不用改——
这正是文档 tab 里"端点值按……" 那句话说的东西。

`pnpm typecheck` 跑 `tsc --noEmit`。
