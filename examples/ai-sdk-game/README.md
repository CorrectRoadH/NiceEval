# 例子：评测用 AI SDK 构建的游戏 Agent

这个例子展示如何用 fasteval 评测一个**用 Vercel AI SDK 构建的文字游戏**。

游戏是一个「谜语问答游戏」：
- 游戏（`agents/riddle-game.ts`）用 AI SDK 的 `generateText` 出谜题、接受玩家答案、判断对错
- fasteval 通过 `defineAgent` 接入这个游戏，自动化地扮演玩家角色
- eval 断言游戏的行为是否符合预期（谜题质量、判题准确性、提示有没有泄底）

这种模式适合：
- 评测你的 AI 游戏 / 对话系统的质量
- 评测 AI SDK / LangChain / LangGraph 等框架构建的 agent
- 在 CI 里对任意 LLM 应用做回归测试

## 目录结构

```
ai-sdk-game/
├── README.md
├── fasteval.config.ts
├── agents/
│   └── riddle-game.ts         # fasteval 适配器:把 AI SDK 游戏包成 Agent
├── evals/
│   ├── riddle-quality.eval.ts # 谜题质量:出的谜是否合理？
│   ├── answer-judging.eval.ts # 判题准确性:对的说对、错的说错？
│   └── hint-safety.eval.ts    # 提示安全性:hint 没有直接泄露答案？
└── experiments/
    └── compare-models.ts      # 对比不同 LLM 的游戏质量
```

## 快速开始

### 1. 安装依赖

```sh
npm install -D fasteval
npm install ai @ai-sdk/openai    # 或 @ai-sdk/anthropic
```

### 2. 配置环境变量

```sh
export OPENAI_API_KEY=sk-...     # 游戏 Agent 内部使用
```

### 3. 运行 eval

```sh
# 运行全部 eval
npx fasteval

# 只运行「判题准确性」这一个
npx fasteval answer-judging

# 对比多个模型
npx fasteval exp compare-models

# 查看详细报告
npx fasteval view
```

## 适配器核心：`agents/riddle-game.ts`

游戏不需要单独启动服务器——适配器直接在进程内调用 AI SDK：

```ts
import { defineAgent } from "fasteval";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export default defineAgent({
  name: "riddle-game",
  capabilities: { conversation: true },
  async send(input, ctx) {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      system: GAME_SYSTEM_PROMPT,
      messages: buildMessages(ctx.session, input.text),
      abortSignal: ctx.signal,
    });
    return {
      events: [{ type: "message", role: "assistant", text }],
      status: "completed",
    };
  },
});
```

## 适配 HTTP 服务（生产环境模式）

如果你的游戏是一个独立的 HTTP 服务（Next.js Route Handler、Express、Fastify 等），
把 `send` 里的 `generateText` 替换成 `fetch`：

```ts
async send(input, ctx) {
  const r = await fetch(`${process.env.GAME_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: ctx.session.id ?? crypto.randomUUID(),
      message: input.text,
    }),
    signal: ctx.signal,
  });
  const { reply, sessionId } = await r.json();
  ctx.session.id = sessionId;   // 保存 session id 供多轮 resume
  return {
    events: [{ type: "message", role: "assistant", text: reply }],
    status: "completed",
  };
},
```

```sh
GAME_URL=http://localhost:3000 npx fasteval   # 评本地
GAME_URL=https://my-game.vercel.app npx fasteval  # 评线上
```

## 扩展：对比多个模型

```ts
// experiments/compare-models.ts
export default defineExperiment({
  agent: riddleGameAgent,
  model: ["gpt-4o-mini", "gpt-4o", "claude-haiku-4-5"],  // 三个模型一起跑
  runs: 5,
});
```

`fasteval exp compare-models` 会为每个模型单独出报告，通过率一目了然。
