# vm0 示例

演示怎么用 **vm0**([github.com/vm0-ai/vm0](https://github.com/vm0-ai/vm0),
产品名 Zero)搭一个 agent 后端(HTTP 服务器 + 一个极简聊天页面)。**独立项目,
不接 niceeval**——不 import `niceeval`,没有 `adapter/`、`evals/`、
`niceeval.config.ts`。

## vm0 是什么样的运行时(为什么接法长这样)

vm0 是**托管的 agent 运行时**:agent 用一份声明式的 `vm0.yaml`(agent compose)
定义——`framework: claude-code`(或 `codex`)加一份自然语言指令(`AGENTS.md`,
挂载为沙箱内的 CLAUDE.md)——`vm0 compose` 部署到平台后,每次 run 都在平台的
Firecracker microVM 沙箱里真实执行,事件流回平台。

它**没有可 `import` 的 npm SDK**(npm 上只有 CLI `@vm0/cli` 和自托管 runner
`@vm0/runner`),但有**公开、版本化的 JSON REST 契约**——源码就在 vm0 仓库
`turbo/packages/api-contracts/`,官方 CLI 是这套契约的薄客户端,
`vm0 auth setup-token` 就是官方给 CI/程序化调用发 token 的通道(vm0 官方的
GitHub Action 也是这么接的)。所以接 vm0 的方式不是装 SDK,而是:

1. 用 CLI 部署 agent compose(一次性);
2. 后端拿 token 直接打 REST API:`POST /api/agent/runs` 创建 run(首轮带
   `agentComposeId`,续轮带 `sessionId` 接同一会话),轮询
   `GET /api/agent/runs/:id/events` 拿事件;
3. `eventData` 就是沙箱里 claude-code 的原始 stream-JSON 事件(`assistant`
   文本 / `tool_use` / `tool_result` / `result`)——官方 CLI 的 `vm0 run`
   渲染的也是同一条事件流。本示例把它原样经 SSE 转发给前端按类型渲染。

和其它 examples 的天气/计算器工具不同,vm0 的 agent 是"沙箱里的 claude-code",
所以聊天框发的是**自然语言任务**("算一下 12\*(3+4)"、"写个文件把结果存下来"),
工具调用面板里看到的是沙箱内真实的 Bash/文件操作。

## 目录结构

- `vm0.yaml`:agent compose(`vm0 init` 生成的标准形状)——agent 名
  `niceeval-demo`,`framework: claude-code`,指令在 `AGENTS.md`。
- `AGENTS.md`:agent 的自然语言指令。
- `server.ts`:一个 `node:http` 服务器,无框架。
  - `GET /healthz` → `{ok:true}`
  - `GET /` → 返回 `public/index.html`
  - `POST /api/chat`,body `{message, sessionId?}` → `text/event-stream`:
    创建 run 后轮询事件,每帧 `data:` 是一个原样的 claude-code stream-JSON 事件;
    另加 `vm0.run.created`(带 `sessionId`,前端保存续会话)/`vm0.run.finished`/
    `vm0.error` 三种信封帧。浏览器断开时调 `POST /api/agent/runs/:id/cancel`
    取消 run。
- `public/index.html`:单文件静态前端,`fetch()` 读 SSE 流,按事件类型渲染
  文本、tool_use/tool_result(按 `tool_use_id` 配对)。
- `.env.example`:`VM0_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN`(或
  `ANTHROPIC_API_KEY`)/ `VM0_API_URL` / `VM0_AGENT_NAME` / `PORT`。

## 跑起来

一次性准备(部署 agent compose + 拿 token):

```sh
npm i -g @vm0/cli
vm0 auth login                # 设备码登录 vm0.ai 账号
cd examples/zh/origin/vm0
vm0 compose vm0.yaml          # 部署本目录的 agent compose(名字 niceeval-demo)
vm0 auth setup-token          # 输出程序化调用的 token,填进 .env 的 VM0_TOKEN
```

然后:

```sh
pnpm install
cp .env.example .env
# .env 里填 VM0_TOKEN 和 CLAUDE_CODE_OAUTH_TOKEN(或 ANTHROPIC_API_KEY)

pnpm dev
# 浏览器打开 http://localhost:5588,或直接看 SSE 事件流:
curl -N -X POST localhost:5588/api/chat -H 'content-type: application/json' \
  -d '{"message":"算一下 12*(3+4)"}'
```

注意:每个 run 都是真实的 microVM 任务(启动沙箱 + 跑 claude-code),首条回复
通常要几十秒——所以前端必须按事件流实时渲染,而不是憋一个整块回复。

## 备注:关于"vm0 没有公开 API"的旧结论

这个目录曾经是一个只有 mock 的占位,依据是"vm0 没有 npm SDK、没有公开 HTTP
API"。前半句今天(2026-07)仍然成立,后半句不成立:REST 契约是公开源码
(`turbo/packages/api-contracts/`),`vm0 auth setup-token` 官方支持程序化调用,
`vm0 run` 本身就是同步轮询同一组端点。本示例即按这套公开契约实现。
`docs/adapters/targets.md` 里"事件 schema 未公开"的判断也需要按此更新——事件
就是 claude-code / codex 的原生 stream-JSON,schema 跟着 framework 走。
