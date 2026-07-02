# LangGraph / LangChain + LangSmith OTel 示例(Python)

这个示例演示 LangGraph 官方推荐的最小聊天应用形状,后端用 **Python**——LangGraph
最常见的使用方式(LangChain 1.x):

- **后端零服务器代码**:`src/agent.py` 用 `create_agent`(`langchain` 包,内部就是
  一个编译好的 LangGraph 图)定义 agent 并导出,`langgraph.json` 指到这个导出,
  由 **Agent Server**(`langgraph dev`,pip 包 `langgraph-cli[inmem]`)加载——线程
  管理、流式 API、checkpoint 全部由服务器提供,不手写任何 HTTP 路由。
- **前端用官方 hook**:React + `@langchain/react` 的 `useStream()` 直连 Agent Server
  (默认 `http://localhost:2024`),token 拼接、工具调用生命周期(参数/结果/状态)、
  线程续接全部由 hook 处理,不自己解析 SSE、不发明 `{reply, toolCalls}` 中间格式。
  前后端跨语言(Python 后端 + TS 前端)正是 Agent Server 这层协议的意义。

同时它是 [`docs-site/zh/guides/connect-otel.mdx`](../../../../docs-site/zh/guides/connect-otel.mdx)
"2. 应用侧" 一节里 **LangGraph / LangChain** tab 的可跑版本:Python 版 `langsmith`
SDK 的 LangSmith OTel 导出是**真·零代码**——四个环境变量(见 `.env.example`),
import 时自动挂 OTel hook,没有任何 observability 接线代码(JS 版还需要显式调一次
`initializeOTEL()`,这是文档 tab 里说的那处差异)。它是一个**普通的 LangGraph
应用**——不接 niceeval,没有 `adapter/`、`evals/`、`niceeval.config.ts`。

## 目录结构

- `langgraph.json`:Agent Server 的配置——`graphs.agent` 指向 `src/agent.py` 的
  `agent` 导出,`env: ".env"` 让服务器启动时加载环境变量。
- `src/agent.py`:整个后端。两个工具(`get_weather` 固定城市表 + 未知城市确定性
  伪随机;`calculate` 不用 `eval()` 的递归下降算术解析器)+ `ChatOpenAI` +
  `create_agent`(LangChain 1.x 推荐写法,替代旧的 `create_react_agent`)。
  不配 checkpointer——Agent Server 自己管线程持久化(dev 模式存内存,重启即丢)。
- `requirements.txt`:`langchain`、`langchain-openai`、`langsmith[otel]`、
  `langgraph-cli[inmem]`。
- `src/client/App.tsx`:React 聊天页,`useStream({ apiUrl, assistantId, threadId,
  onThreadId })`,渲染 `stream.messages` / `stream.toolCalls`,`stream.stop()` 停止。
- `index.html` / `vite.config.ts` / `package.json`:Vite 前端(端口 5173),npm 依赖
  只有前端的(React + `@langchain/react`)。
- `docker-compose.yml`:本地自托管的 trace 查看器(Jaeger),接收 OTLP/HTTP。

## 跑起来

后端是 Python 项目(venv + `requirements.txt`),前端是 npm 项目,互不共享依赖。

```sh
cd examples/zh/origin/langgraph

# Python 侧(Agent Server)
python3 -m venv .venv        # 需要 Python >= 3.11
.venv/bin/pip install -r requirements.txt

# 前端
pnpm install

cp .env.example .env
# .env 里填 OPENAI_API_KEY(可选 OPENAI_BASE_URL / AGENT_MODEL)
```

```sh
pnpm dev
# server = Agent Server(.venv/bin/langgraph dev,http://localhost:2024,
#          本地免费跑,不需要 LANGSMITH_API_KEY;API 文档在 http://localhost:2024/docs)
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

`pnpm typecheck` 跑前端的 `tsc --noEmit`。
