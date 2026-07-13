# LangGraph

LangGraph 的目标接入面是官方 event streaming 协议转换器：

```ts
fromLangGraphEvents()
```

该转换器是待实现的目标契约，不提供 `langGraphAgent()` 工厂。LangGraph 可以进程内运行，也可以部署在自建 HTTP 服务或 Agent Server 后；niceeval 不绑定其中一种 transport。

转换器应覆盖：

- `messages` channel 的 text、reasoning 与 tool-call content blocks；
- `tools` channel 的 started、finished 与 error，并按 tool call ID 配对；
- `input` / interrupt 到 `input.requested`；
- `lifecycle` 的 completed、failed 与 interrupted；
- `namespace` 中的 subgraph / subagent 层级；
- message finish 上可得的 usage；
- 协议 `seq` 所定义的事件顺序。

Adapter 使用 `thread_id` 作为 `ctx.session.id`，并按应用协议把 `input.responses` 翻译成 `Command(resume=...)`。这些 transport 与会话操作不进入转换器。

当前 Tier 1 示例证明自定义 SSE 映射、会话和 HITL 路径可运行；转换器落地后，示例应改为消费 LangGraph 官方协议 fixture，删除重复状态机。见 [`examples/zh/tier1/langgraph/`](../../../../examples/zh/tier1/langgraph/)。
