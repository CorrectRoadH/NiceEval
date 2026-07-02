# Codex SDK × niceeval(非侵入式接入)

在 [`examples/zh/origin/codex-sdk`](../../origin/codex-sdk/) 的基础上接入 niceeval——
应用代码(`agent.ts`、`server.ts`、`public/index.html`)复制自 origin 的一个早期快照,
niceeval 相关的全部代码都是新文件(`agents/`、`evals/`、`experiments/`、
`niceeval.config.ts`)。(origin 那份后来已改成 SDK 原生的 `runStreamed()` + SSE 事件流
接口;这里保留旧的阻塞式 `/api/chat` JSON 接口不动,因为下面的 adapter 依赖它。)origin
那份 README 的「为什么任务形状长这样」讲了 Codex SDK 是"目录里的编码 agent"(内置文件
读写、跑 shell 命令),不是通用 chat SDK——这里的 eval 就是照这个任务形状写的:自然语言
编码请求,断言真实的文件/命令操作,而不是硬凑天气/计算器工具。

## 接线方式:非侵入式 remote agent adapter

[`agents/codex-sdk.ts`](agents/codex-sdk.ts) 把应用自己的 `server.ts` 当黑盒 spawn 起来
(端口 5199,`GET /healthz` 探活),然后按普通"deployed agent"adapter 的写法
(见 [Remote Agent 指南](../../../../docs-site/guides/remote-agent.mdx))对 `POST /api/chat`
发 `fetch`,把响应里的 `toolCalls: [{name, input, output}]` 映射成 niceeval 的标准
`StreamEvent[]`:

- `command_execution` / `file_change` / `mcp:*` / `web_search` / `todo_list` → 一对
  `action.called` + `action.result`(`callId` 用 `${name}-${index}` 拼出来,应用自己的
  响应里没有这个字段)。
- `error`(s2a 代理常见的"Falling back from WebSockets to HTTPS transport"这类可恢复
  提示,turn 本身照常完成)→ 映射成标准事件流里专门给"agent 报告的非致命错误"用的
  `{ type: "error", message }`,**不**算进 `action.called/result`——否则每次这个提示
  出现都会让 `t.noFailedActions()` 误判成"工具失败"。

`capabilities: { conversation: true, toolObservability: true }`——`ctx.session.id` 双向
读写,直接对应应用自己的 `sessionId → threadId` 续接机制(见 `agent.ts`)。

## evals

- [`evals/create-file.eval.ts`](evals/create-file.eval.ts):T1,单轮创建文件。断言
  `action.called` 里出现了带文件名的 `file_change` 或 `command_execution`(不锁死 Codex
  选哪种底层实现)、`noFailedActions()`,**并且直接读 `workspace/` 目录**确认磁盘上真的
  有这个文件、内容对得上——不只信模型自己说"创建成功"。文件名/内容每次运行随机生成,
  避免多次运行互相污染。
- [`evals/list-files.eval.ts`](evals/list-files.eval.ts):T2,同一 session 两轮。第一轮
  建一个随机命名的文件,第二轮追问"列出目录、告诉我刚创建的是哪个"。断言第二轮
  `action.result` 的真实工具输出(而不是回复文本)里包含这个文件名——文件名是运行时
  随机生成的,不可能是训练数据背出来的静态答案,只有真的又跑了一次 `ls` / `rg --files`
  之类的命令、读到磁盘上第一轮写下的文件,这个断言才会过。

## 跑起来

这个目录是一个**独立的 npm 项目**(自带 `package.json`,`niceeval` 以 link 方式指向
仓库根)。

```sh
cd examples/zh/eval/codex-sdk
pnpm install
cp .env.example .env   # 已有一份带真实凭据的 .env,一般不需要重新填

pnpm exec niceeval list           # 列出 eval
pnpm exec niceeval exp codex-sdk  # 真调用 Codex SDK 跑两条 eval
pnpm exec niceeval view           # 本地查看器
```

也可以像 origin 版本一样起服务器手动试聊天(不跑 eval):

```sh
pnpm dev   # 起 server(5199),curl 或浏览器打开 public/index.html 手动试
```

注意:

- `niceeval.config.ts` 里 `maxConcurrency: 1`——`agent.ts` 的 `WORKSPACE_DIR` 是这个进程
  全程共享的同一个 scratch 目录(不是按 session 分开的),并发跑会互相踩文件。
- `timeoutMs: 180_000`——Codex 一轮要真的起 codex CLI 子进程、走真实文件/命令操作,比纯
  聊天调用慢得多。
- judge 走 `gpt-5.4`,鉴权复用 `.env` 里的 `CODEX_API_KEY` / `CODEX_BASE_URL`(niceeval
  的 judge 解析顺序里 `CODEX_BASE_URL` / `CODEX_API_KEY` 就是 fallback 之一,见
  `src/scoring/judge.ts`),不需要额外配 `OPENAI_API_KEY`。
