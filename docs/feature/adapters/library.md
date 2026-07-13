# Adapters —— 库用法

Adapter 作者从 `niceeval/adapter` 导入构造器、转换器与流式组合件。这一页从可运行代码开始；内部数据结构和不变量见 [Architecture](architecture.md)。

## Remote Agent

被测对象通过 HTTP、RPC 或其它进程外协议提供服务时，使用 `defineAgent`：

```ts
import { defineAgent } from "niceeval/adapter";

export default defineAgent({
  name: "support-bot",
  async send(input, ctx) {
    const response = await fetch(`${process.env.AGENT_URL}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: input.text, sessionId: ctx.session.id }),
      signal: ctx.signal,
    });
    const body = await response.json();
    if (body.sessionId) ctx.session.capture(body.sessionId);
    return { status: "completed", data: body.output, events: toStreamEvents(body) };
  },
});
```

URL、鉴权和请求体是 Adapter 的私有协议。model、reasoning effort 与实验 flags 来自 `ctx`，由 experiment 决定。

## Sandbox Agent

被测对象是在隔离环境中运行的 coding-agent CLI 时，使用 `defineSandboxAgent`。安装 CLI、写鉴权和安装扩展放在 `setup`，每轮执行与 transcript 采集放在 `send`：

```ts
import { defineSandboxAgent } from "niceeval/adapter";

export default defineSandboxAgent({
  name: "my-coding-agent",
  async setup(ctx) {
    await ctx.sandbox.runCommand("npm", ["install", "-g", "my-agent"]);
  },
  async send(input, ctx) {
    const result = await ctx.sandbox.runCommand("my-agent", ["--json", input.text]);
    return {
      status: result.exitCode === 0 ? "completed" : "failed",
      events: parseTranscript(result.stdout),
    };
  },
});
```

内置 coding agents 见 [SDK 与 Agent 索引](sdk/README.md)，扩展配置见 [配置 Coding Agent 扩展](library/coding-agent-extensions.md)。

## 递进实现

| 增量 | Adapter 义务 | 解锁的行为 |
|---|---|---|
| 收发消息 | 返回真实 `status` 与 `data` | 单轮发送、输出断言 |
| 标准事件流 | 完整映射消息、工具与结果，保持顺序和 call ID | 工具、消息与事件断言 |
| 多轮会话 | 使用 `ctx.session.history()` 或 `id` / `capture()` | 多轮与 `newSession()` |
| HITL | 返回 `waiting`、`input.requested`，按 request ID 恢复 | `parked`、`requireInputRequest`、`respond` |
| tracing | 配置 exporter 与 span mapper | 结果 trace 和 view 瀑布图 |

这条递进路径描述一个 Adapter 实现了多少行为，与 Tier 1/2/3 描述的应用侵入程度是两条正交坐标。

## 会话存取器

| 存取器 | 后端形态 |
|---|---|
| `ctx.session.history<T>()` | 无状态服务；每轮重发完整消息历史 |
| `ctx.session.id` / `capture(id)` | 服务端保存历史；请求携带 session/thread ID |
| `ctx.session.hold(value)` / `take<T>()` | HITL 暂停时保存未消费的流或审批现场 |

会话状态只保存在 `ctx.session`。模块级 Map 会让并发 attempt 或 `t.newSession()` 之间串线。

## 按任务继续

| 现在要做什么 | 阅读 |
|---|---|
| 从最小 `send` 开始逐步补能力 | [编写 Adapter](library/writing-an-adapter.md) |
| 连接 HTTP / RPC / SDK 服务 | [Remote Agent](library/remote-agent.md) |
| 在 Sandbox 中运行 coding-agent CLI | [Sandbox Agent](library/sandbox-agent.md) |
| 消费 SSE、SDK frames 或 delta | [流式协议与共享工具](library/streaming.md) |
| 实现多轮和审批恢复 | [使用会话与 HITL](library/sessions-and-hitl.md) |
| 安装 Skills、MCP 和原生 Plugins | [配置 Coding Agent 扩展](library/coding-agent-extensions.md) |

事件数据结构、会话状态模型和负断言完整性属于实现不变量，分别见 [标准事件模型](architecture/events.md)、[会话状态模型](architecture/session-state.md) 和 [断言证据](architecture/evidence.md)。

## SDK 与协议转换器

不同 SDK 不在本页堆叠。每个 SDK 使用独立小文件记录其入口、原始事件、会话、HITL、usage 和完整性边界：

- [AI SDK](sdk/ai-sdk.md)
- [Claude Agent SDK](sdk/claude-agent-sdk.md)
- [Codex SDK](sdk/codex-sdk.md)
- [pi-agent-core](sdk/pi-agent-core.md)
- [LangGraph](sdk/langgraph.md)
- [OpenClaw](sdk/openclaw.md)
