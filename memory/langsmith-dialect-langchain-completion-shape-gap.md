---
name: langsmith-dialect-langchain-completion-shape-gap
description: src/o11y/otlp/dialects.ts 的 langsmith 方言解析不了 LangChain ChatOpenAI 包装器实际吐的 gen_ai.completion 形状,message 事件永远派生成空——工具/usage 派生不受影响
metadata:
  type: infra-bug
---

**现象**：`examples/zh/tier1/langgraph`(真实 LangGraph + LangSmith OTEL_ONLY 导出)跑
`weather-tool.eval.ts` 时,`t.calledTool("get_weather", ...)` 和 usage 都正确(工具断言、
token 数全对),但 `t.messageIncludes(...)` 总是失败——`niceeval view` / `events.json` 里
完全没有 `{type:"message", role:"assistant"}` 事件,即使原始 SSE 帧(`text-delta`)里模型确实
吐了完整的自然语言回复(比如"北京今天天气不错哦！☀️ 当前**晴朗**，气温 **26°C**...")。

**根因**：`src/o11y/otlp/dialects.ts` 的 `langsmith` 方言,`kind === "llm"` 分支只认得
`gen_ai.completion` 三种形状:纯字符串、`{content: string}`、或 `assistantTextFromMessages`
认的"消息数组"形状(`[{role, content}]`)。LangChain 的 `ChatOpenAI` 包装器实际吐的
`gen_ai.completion` 是 `{"generations":[[{"text": "...", "message": {...}, ...}]]}`
——生成候选数组套一层(`generations[0][0].text`),三种已知形状都不命中,`text` 解析成
`undefined`,`message([])` 直接吐空事件。**这只影响 assistant 文本派生**,同一个 span 的
`gen_ai.usage.*` 属性走独立字段读取,usage 聚合完全不受影响;`kind === "tool"` 分支读的是
`gen_ai.prompt`/`gen_ai.completion` 但走的是工具调用那条分支,shape 对得上,`action.called`/
`action.result` 也完全正常。

另外一个相关但独立的现象:LangSmith 的 `OtelSpanProcessor` 是标准 `BatchSpanProcessor`(读
`OTEL_BSP_SCHEDULE_DELAY` 环境变量,默认 5000ms),"这一轮 HTTP 请求几时返回"和"批处理几时把
span 真正导出"是两条不对齐的时间线——即使把 `OTEL_BSP_SCHEDULE_DELAY` 调到 200ms,拿到工具
结果后生成最终自然语言回复的那次模型调用,它的 span 经常在 SSE 流已经吐完 `finish`、连接已经
关闭之后才真正被导出,niceeval 的本轮收集窗口这时已经关了。

**修法 / 适用场景**：
- 本次(`examples/zh/tier1/langgraph/agents/langgraph.ts`)双管齐下:
  1. `tracing.env` 里额外注入 `OTEL_BSP_SCHEDULE_DELAY: "200"`(标准 OTel 环境变量,不用碰
     应用代码),把批处理调度间隔调短;
  2. adapter 的 `drainStream` 在轮次真正结束(`finish` 帧或流自然关闭)后主动 `await` 一段
     宽限时间(`OTEL_FLUSH_GRACE_MS = 600`),把 niceeval 的收集窗口人为拉宽,让最后一批
     span 有时间落进来——工具调用 span 因此也更稳定,不只是为了 usage。
  3. `message` 事件不指望 span 派生:adapter 自己累积协议原生的 `text-delta` 帧拼成完整回复,
     在这一轮结束时手动 push 一条 `{type:"message", role:"assistant", text}` 事件,和
     `otelEvents()` 派生的工具/usage 事件按文档设计的"两边按时间戳合并"机制共存——这不是
     workaround,是文档本来就写明的正常用法(`send` 的 `events` 与 span 派生结果合并),只是
     这次真正用上是因为 span 那条链路对这个生态的消息文本解析不出来。
- 核心 `langsmith` 方言的 `gen_ai.completion` 解析本可以再加一种形状识别
  (`generations[0][0].text` 或 `generations[0][0].message.content`),让 LangChain 原生的
  `ChatOpenAI`/`create_agent` 组合开箱可用,不需要每个黑盒接入都重复这个 adapter 侧补丁——
  但这次是 Tier 1"只做示例接入,不碰 core"的工单范围,没有改 `src/o11y/otlp/dialects.ts`,
  只记录在这里。以后要接其它走 `create_agent`/`ChatOpenAI` + LangSmith OTel 路线的黑盒应用,
  先假设会踩到同一个 gap,别急着怀疑自己的帧映射。
