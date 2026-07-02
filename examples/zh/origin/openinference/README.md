# OpenInference + Phoenix 埋点示例

这是 [`docs-site/zh/guides/connect-otel.mdx`](../../../../docs-site/zh/guides/connect-otel.mdx)
「2. 应用侧」OpenInference tab 那几行配置摊开成的完整可跑 app：一个 FastAPI 后端 + 一个
带两个工具（查天气 / 算算术）的 LangChain agent，用 `LangChainInstrumentor` 自动埋点，
span 发给 Phoenix。**Python 写的**——OpenInference / Phoenix 生态本身以 Python 为主，
这里跟着生态走。**不依赖、不导入 niceeval**，是个完全独立的项目，没有 `package.json`，
不属于仓库根目录的 pnpm workspace。真的会调用模型——没有 mock 回复路径。

## 目录结构

- `observability.py`:埋点接线（`phoenix.otel.register()` +
  `LangChainInstrumentor().instrument()`）。必须在 `server.py` 里被最先 import，
  因为 `LangChainInstrumentor` 在 import 时就 patch LangChain 的 callback 系统，
  晚了不报错、只是静默拿不到 span。
- `tools.py`:两个工具，`get_weather`（合成天气数据，不接外部 API）和 `calculate`
  （AST 白名单实现的安全算术求值，不是 `eval()`）。
- `agent.py`:真的过一遍 LangChain 1.x 的 `create_agent`，`build_agent()` 建 agent、
  `get_reply()` 跑一轮对话并把 tool call 提取出来。
- `server.py`:先 `import observability`（吃它的 side effect），然后是 FastAPI app、
  `ChatRequest`/`ToolCall`/`ChatResponse` 模型，以及三个路由：`GET /healthz`、
  `GET /`(前端 HTML)、`POST /api/chat`（调用 `agent.get_reply`）。
- `static/index.html`:单文件前端,内联 `<style>`/`<script>`,没有构建步骤,`fetch()`
  打 `/api/chat`。
- `docker-compose.yml`:本地起 Arize Phoenix,看 trace 用。
- `requirements.txt`:`fastapi`、`uvicorn`、`langchain`、`langchain-openai`、
  `openinference-instrumentation-langchain`、`arize-phoenix-otel`、`python-dotenv`。

## 跑起来

这个目录是一个**独立的 Python 项目**,跟仓库其它 TS 示例不共享依赖。

```sh
cd examples/zh/origin/openinference
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# 填好 OPENAI_API_KEY(和可选的 OPENAI_BASE_URL / AGENT_MODEL)—— 真的要调用模型
```

```sh
uvicorn server:app --reload --port 8787
# 浏览器打开 http://localhost:8787
```

看 trace:

```sh
docker compose up -d
open http://localhost:6006   # Phoenix UI,聊几句之后刷新能看到 get_weather / calculate 的 TOOL span
```

`server.py` 里的 `phoenix.otel.register()` 默认读 `PHOENIX_COLLECTOR_ENDPOINT`(读不到
退回标准的 `OTEL_EXPORTER_OTLP_ENDPOINT`,都没设就用 `localhost`)。有个反直觉的地方:
没显式传 `protocol="http/protobuf"` 时,`phoenix.otel` 只取这个值的 host、把端口强制
换成 gRPC 端口(默认 4317),不管你写的端口是几——`docker-compose.yml` 里的本地 Phoenix
两个端口都开着(6006 给 UI/HTTP,4317 给 gRPC),所以默认配置不用改就能连上,只是实际走
的是 gRPC:4317,不是看起来的 HTTP:6006。

## 和文档的关系

这个示例把 [`connect-otel.mdx`](../../../../docs-site/zh/guides/connect-otel.mdx) 「2. 应用侧」
OpenInference tab 里的几行配置

```python
from openinference.instrumentation.langchain import LangChainInstrumentor
from phoenix.otel import register

register()  # 或标准 OTel SDK;endpoint 走 OTEL_EXPORTER_OTLP_ENDPOINT
LangChainInstrumentor().instrument()
```

摊开成了一个真的能跑、能在 Phoenix UI 里看到 span 的完整 app。
