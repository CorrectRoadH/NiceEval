# AI SDK Web Agent Example

这个例子演示一个用 AI SDK tool loop 实现的谜语 web agent，如何通过 `defineAgent` 接进 fasteval。

结构：

- `ai-sdk-agent/`：被测 web agent。它暴露 `POST /api/turn`，内部有 `select_riddle`、`judge_guess`、`give_hint`、`reveal_answer` 四个工具。
- `ai-sdk-agent/langfuse/`：被测应用自己的 Langfuse self-host 配置。fasteval 的报告/事件流是外层观测；Langfuse 是 app 内部观测。
- `agents/riddle-game.ts`：fasteval adapter。它读取 `RIDDLE_AGENT_URL`，把 HTTP 响应映射成标准 `StreamEvent[]`。
- `evals/`：对出题质量、判题准确性、提示安全性做会话型 eval。

## 启动被测 agent

先启动 web agent：

```sh
cd examples/ai-sdk/ai-sdk-agent
pnpm install
pnpm dev
```

默认是 `RIDDLE_AGENT_MODE=mock`，不需要 API key，适合先验证 fasteval 接线。要跑真实 AI SDK：

```sh
RIDDLE_AGENT_MODE=ai OPENAI_API_KEY=... pnpm dev
```

如果要看应用自己的 Langfuse trace：

```sh
cd examples/ai-sdk/ai-sdk-agent/langfuse
cp .env.example .env
# 编辑 .env，把 replace-me 的 key/password 换成本机值
docker compose up -d
```

然后把 `LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 填到 `ai-sdk-agent/.env`。不要提交 `.env`；仓库里只保留 `.env.example` 和变量化的 compose。

可选变量：

- `PORT`：web agent 端口，默认 `5188`
- `OPENAI_BASE_URL`：OpenAI-compatible 网关
- `RIDDLE_AGENT_MODEL`：web agent 默认模型，默认 `gpt-4o-mini`

## 跑 eval

另开一个终端：

```sh
cd examples/ai-sdk
RIDDLE_AGENT_URL=http://127.0.0.1:5188 node ../../bin/fasteval.js list
RIDDLE_AGENT_URL=http://127.0.0.1:5188 node ../../bin/fasteval.js riddle-quality
```

`fasteval.config.ts` 注册的是 remote agent，所以不会创建 Docker 沙箱；如果 eval 里使用 `t.diff`、`t.testsPassed()` 或 workspace 文件断言，需要改用 sandbox agent。

没有 judge API key 时，eval 只跑确定性断言和工具调用断言；设置 `OPENAI_API_KEY`、`CODEX_API_KEY` 或 `FASTEVAL_JUDGE_KEY` 后，会额外启用 soft judge 评分。
