// LangChain 1.x 的推荐写法:createAgent(内部就是一个编译好的 LangGraph 图),
// 从这里 export,langgraph.json 的 graphs.agent 指到这个导出,由 Agent Server
// (`langgraphjs dev`)加载并对外提供线程管理 + 流式 API——服务器我们一行都不用写。
//
// 这条路径会经过 @langchain/core 的埋点,配合 ./observability.ts 里注册的
// LangSmith OTel exporter 出 span(env 没开就跳过)。
import "./observability.ts";

import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { agentTools } from "./tools.ts";

const SYSTEM_PROMPT = `你是一个乐于助人的中文 AI 助手。
需要天气信息时调用 get_weather,并用工具返回的数据作答,不要凭空编造天气。
需要精确计算时调用 calculate,把表达式交给它算,不要心算。
普通闲聊不要调用任何工具。回复保持中文、友好、简洁。`;

const llm = new ChatOpenAI({
  model: process.env.AGENT_MODEL ?? "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : undefined,
});

// 不配 checkpointer:Agent Server 自己管线程持久化(thread = 会话),
// 本地 dev 模式存内存,重启服务器就丢——演示用足够了。
export const agent = createAgent({
  model: llm,
  tools: agentTools,
  systemPrompt: SYSTEM_PROMPT,
});
