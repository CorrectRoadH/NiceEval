---
name: ai-sdk-otel-needsapproval-no-execute-tool-span
description: "@ai-sdk/otel 不给 needsApproval:true 的工具在批准后的真实执行产 execute_tool 类型 span——genAi 方言派生不出这类工具的 action.called/result,普通工具不受影响"
metadata:
  type: infra-bug
---

**现象**：`examples/zh/tier1/ai-sdk-v7`(黑盒 HTTP 接 AI SDK v7,`events: otelEvents({ dialects: [otel.genAi] })`)跑 `hitl-approve.eval.ts`——`calculate` 工具声明了
`needsApproval: true`,approve 之后模型确实拿到了正确的计算结果(assistant 回复"计算结果是
126"),但 `t.calledTool("calculate", {status:"completed"})` 断言失败,`niceeval` 报告这一轮
"0 tools"。同一个 eval 套件里 `get_weather`(没有 `needsApproval`)的 `calledTool` 断言完全
正常。

**根因**：抓 `.niceeval/*/hitl-approve/*/trace.json` 发现,resume(approve)那一轮实际收到的
3 个 span 是 `invoke_agent` / `chat` / `agent_step`(`gen_ai.operation.name` 分别是
`invoke_agent`/`chat`/`agent_step`),**没有一个 `gen_ai.operation.name === "execute_tool"`
的 span**——`calculate` 的真实执行结果(`126`)只是作为 `chat` span 的
`gen_ai.input.messages` 里一条 `tool_call_response` 内容出现,从没有被单独打成一个工具执行
span。`src/o11y/otlp/dialects.ts` 的 `genAi` 方言只在 `op === "execute_tool"` 时才派生
`action.called`/`action.result`(`toolPair(...)`),既然没有这个 span,派生结果就是空。这不是
niceeval 的映射 bug,是 `@ai-sdk/otel`(官方 GenAI semconv 集成)对 `needsApproval` 这条
resume-after-approval 路径确实没有插桩——普通(无审批门)工具走的是常规 tool-call 循环,
`execute_tool` span 完全正常。

deny 分支还有一层更彻底的缺失:被拒绝的调用**根本不会真的执行**,`execution-denied` 结果是
在 `convertToModelMessages` 转换历史时合成进 `ModelMessage`(角色 `tool`,
`output:{type:"execution-denied", reason}`)喂给模型的,连一条 SSE `tool-output-*` chunk 都
不会有——如果指望"从这一轮的原始帧里翻出 denied 事件",翻遍整条流也翻不到,唯一的信息源是
adapter 自己在决定 approve/deny 那一刻手上已有的数据(`toolCallId`/`name`/`input`)。

**修法 / 适用场景**：
- `examples/zh/tier1/ai-sdk-v7/agents/ai-sdk-v7.ts` 的处理:只对已知的 gated 工具
  (`GATED_TOOLS = new Set(["calculate"])`)在 HITL 续跑分支手动补 `action.called`/
  `action.result`——deny 时两条都在决定的当下直接手写(不等任何帧);approve 时先手写
  `action.called`,再从 SSE 里等 `tool-output-available`(toolCallId 匹配)补上
  `action.result(status:"completed")`。用真实协议里的 `toolCallId` 而不是自造 id——
  `genAi` 方言对普通工具的 span 派生本来就用真实 `gen_ai.tool.call.id`(和协议一致,不像
  langsmith 方言那样退化成 spanId,见 `langsmith-dialect-langchain-completion-shape-gap.md`
  的对照),所以这里手动补的 callId 和"万一某天 @ai-sdk/otel 也给 execute_tool span 打上了"
  的派生结果天然对得上,不会产生幽灵重复记录。
- 顺手在 approval 对象上补了 `reason`(deny 时写"用户拒绝了这次调用,不要重试,直接告知用户
  未能计算"):`@ai-sdk/openai` 会把这段 reason 原样转成模型看到的工具结果文本,不给就是泛泛
  的 `"Tool call execution denied."`——写清楚"别重试"能明显降低模型重新发起同一个调用的
  概率(deepseek-v4-flash 复现过这个"被拒绝一次还要再试一次"的行为,和 claude-sdk /
  langgraph 接入时观察到的一致)。
- 同一份 BatchSpanProcessor 调度延迟问题(`OTEL_BSP_SCHEDULE_DELAY` + 收尾 `OTEL_FLUSH_GRACE_MS`
  宽限时间)在这个应用上也复现了,和 `langsmith-dialect-langchain-completion-shape-gap.md`
  记录的 langgraph 那次是同一个原因、同一个修法,不是这个应用特有的。
- 以后接其它声明了 `needsApproval`/审批门的 AI SDK v7 应用,`get_weather` 这类无门工具直接信
  `otelEvents(genAi)` 就够;凡是走审批-恢复路径的工具,先假设 span 派生拿不到它的执行结果,
  直接在 adapter 里手动补,不用先花时间去确认"是不是我漏配了什么"。
