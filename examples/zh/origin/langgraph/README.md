# LangGraph + LangSmith OTel 示例(纯 Python)

这个示例演示官方当前推荐的 LangGraph agent 写法,并把它接一个最小的聊天页面。
**独立项目,不接 niceeval**——不 import `niceeval`,没有 `adapter/`、`evals/`、
`niceeval.config.ts`。

## agent 怎么搭的:`create_agent`,不是手写 `StateGraph`

`src/agent.py` 用 `langchain.agents.create_agent` 建 agent。这不是"绕开 LangGraph 的
捷径"——`langgraph.prebuilt.create_react_agent` 在 LangGraph 自己的源码里已经标了
deprecated,官方文档现在把 `create_agent` 当成建 agent 的标准入口:`create_agent(...)`
返回的就是一个编译好的 `CompiledStateGraph`(`agent.get_graph()` 能看到 `model` ->
`tools` -> `model` 的循环,和手写 `StateGraph` 编译出来的形状一样),`src/server.py`
直接拿它当 LangGraph 图用(`.stream(..., stream_mode=[...])`、`thread_id` 做会话),
不关心它内部是怎么搭出来的——这正是 `create_agent` 的设计意图:LangGraph 图是共同的
运行时接口,`create_agent` 只是搭图的一种(现在是推荐的那种)方式。

## 目录结构

- `src/agent.py`:整个 agent。两个工具(`get_weather` 固定城市表 + 未知城市确定性
  伪随机;`calculate` 不用 `eval()` 的递归下降算术解析器)+ `ChatOpenAI` +
  `create_agent`。`build_agent()` 返回编译好的图,显式传入的
  `InMemorySaver` 让同一个 `thread_id` 在进程存活期间有多轮记忆。
- `src/server.py`:标准库 `http.server` 写的服务器,没有 FastAPI/Flask——和其它
  `examples/zh/origin/*` 示例"一个 node:http 服务器,无框架"是同一个思路。
  - `GET /healthz` → `{"ok": true}`
  - `GET /` → `public/index.html`
  - `POST /api/chat`,body `{message, sessionId?}` → `text/event-stream`:
    `stream_mode=["messages", "updates"]` 同时订阅 token 级文本 delta(`"messages"`)
    和每个节点跑完后的完整状态增量(`"updates"`,用来拿到成对的、内容完整的
    `{name, input, output}` 工具调用)。节点名 `model`/`tools` 是 `create_agent`
    编译出的图自己定的。sessionId 缺省时服务器生成一个新的 `thread_id`,通过
    `session` 帧发回前端保存——不会把缺失的 id 兜底成某个共享的字面量,避免不同
    调用方互相看到对方的对话历史。
- `public/index.html`:单文件静态前端,`fetch()` 读 SSE 流,按事件类型渲染文本
  delta 和工具调用(`tool-input`/`tool-output` 按 `toolCallId` 配对)。
- `requirements.txt`:`langchain`、`langgraph`、`langchain-openai`、`langsmith[otel]`、
  `python-dotenv`。
- `docker-compose.yml`:本地自托管的 trace 查看器(Jaeger),接收 OTLP/HTTP。

同时它是 [`docs-site/zh/guides/connect-otel.mdx`](../../../../docs-site/zh/guides/connect-otel.mdx)
"2. 应用侧" 一节里 **LangGraph / LangChain** tab 的可跑版本:Python 版 `langsmith`
SDK 的 LangSmith OTel 导出是**真·零代码**——四个环境变量(见 `.env.example`),
`langchain_core` 默认的 tracing callback 第一次调模型时就会按这些变量自动接好 OTel
exporter,没有任何显式的 observability 接线代码(JS 版还需要显式调一次
`initializeOTEL()`,这是文档 tab 里说的那处差异)。

## 跑起来

纯 Python 项目,没有 npm/前端构建步骤。

```sh
cd examples/zh/origin/langgraph
python3 -m venv .venv        # 需要 Python >= 3.11
.venv/bin/pip install -r requirements.txt

cp .env.example .env
# .env 里填 OPENAI_API_KEY(可选 OPENAI_BASE_URL / AGENT_MODEL / PORT)
```

```sh
.venv/bin/python src/server.py
# http://localhost:5488 ,浏览器打开这个地址聊天;
# 也可以直接看 SSE 事件流:
curl -N -X POST localhost:5488/api/chat -H 'content-type: application/json' \
  -d '{"message":"北京天气怎么样?"}'
```

会话即 thread:第一条消息发出后服务器自建 `thread_id`,`session` 帧把 id 交给前端
保存,同一 thread 内多轮对话有记忆(进程内存态,重启就丢)。

看 trace(可选):

```sh
docker compose up -d
# .env 里取消注释 LANGSMITH_TRACING / LANGSMITH_OTEL_ENABLED / LANGSMITH_OTEL_ONLY
# / OTEL_EXPORTER_OTLP_ENDPOINT(默认已指向下面这个本地 Jaeger),重启 server.py
open http://localhost:16686   # Jaeger UI,按 service 名筛 span
```

真要看 LangSmith 官方 UI(prompt/completion 内容、按 run 分组等),把 `.env` 里的
`OTEL_EXPORTER_OTLP_ENDPOINT` 换成 LangSmith 云端端点(`https://api.smith.langchain.com/otel/v1/traces`,
配 `OTEL_EXPORTER_OTLP_HEADERS="x-api-key=<你的 LangSmith key>"`)即可,应用代码不用改——
这正是文档 tab 里"端点值按……" 那句话说的东西。
