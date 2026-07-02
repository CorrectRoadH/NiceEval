# AI SDK v7 助手(接入前)

这是 [`examples/zh/ai-sdk`](../../ai-sdk/) 的 **AI SDK v7 升级版**:同一套本地聊天应用
(HTTP 服务器 + React 聊天 UI)、同一套工具(查天气 / 算数 / 搜索),换成 v7 API,但不接
niceeval、不接观测——纯粹是一个普通的 AI SDK v7 应用。

目录结构对齐 `examples/zh/ai-sdk`:

- `src/assistant.ts`:纯逻辑,不 import 任何 AI SDK 的东西——会话状态
  (`getSession` / `rememberAiTurn` / `sessionMessages`)和三个工具的实现
  (`getWeather` / `calculate` / `webSearch`)。
- `src/models.ts`:模型注册表,OpenAI 兼容的两家 provider,带前端选择器要用的
  `label` / `contextTokens`。
- `src/ai-sdk-runtime.ts`:AI SDK 接线——系统提示、把 `assistant.ts` 的函数包成
  `tool()`、`streamChat()` 用 `streamText` 起一次工具循环,喂给 `server.ts` 的
  流式聊天端点。
- `src/server.ts`:一个 `node:http` 服务器,`/api/models` 给前端拉模型列表,
  `/api/chat` 用 AI SDK 的 UI message stream 格式给 `useChat` 用。
- `src/client/App.tsx` / `App.css`:React 聊天界面(模型选择、流式回复、工具调用
  气泡、图片上传)。

## 跑起来

这个目录是一个**独立的 npm 项目**(自带 `package.json`)。

```sh
cd examples/zh/origin/ai-sdk-v7
pnpm install
cp .env.example .env   # 填 DEEPSEEK_API_KEY / OPENAI_API_KEY
pnpm dev               # 起 server(5188)+ vite dev server(5173),浏览器打开 5173
```
