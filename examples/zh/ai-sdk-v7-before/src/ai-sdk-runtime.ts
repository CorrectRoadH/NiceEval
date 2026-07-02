import { streamText, stepCountIs, tool, convertToModelMessages, type ModelMessage, type UIMessage, type ToolSet } from "ai";
import { z } from "zod";
import { calculate, getWeather, webSearch } from "./assistant.ts";
import { modelSupportsVision, resolveModel } from "./models.ts";

const SYSTEM_PROMPT = `
你是一个乐于助人的中文 AI 助手。

规则：
1. 需要实时天气时，调用 get_weather，并用工具返回的数据作答；不要凭空编造天气。
2. 需要精确计算时，调用 calculate，把表达式交给它算，不要心算。
3. 需要查资料时，调用 web_search，基于返回结果作答。
4. 用户发来图片（消息里带图片）时，直接描述图片内容，不需要调用工具。
5. 普通闲聊不要调用任何工具。回复保持中文、友好、简洁。
`.trim();

function buildTools(): ToolSet {
  return {
    get_weather: tool({
      description: "查询某个城市的当前天气。需要实时天气时调用。",
      inputSchema: z.object({ city: z.string().min(1) }),
      execute: async (input: { city: string }) => getWeather(input),
    }),
    calculate: tool({
      description: "计算一个四则运算表达式(支持 + - * / 和括号)。需要精确计算时调用。",
      inputSchema: z.object({ expression: z.string().min(1) }),
      execute: async (input: { expression: string }) => calculate(input),
    }),
    web_search: tool({
      description: "搜索网络获取资料摘要。需要查资料时调用。",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async (input: { query: string }) => webSearch(input),
    }),
  };
}

/**
 * UI 流式端点：接受 useChat 发来的 UIMessage[] 数组，转换后直接 pipe 到客户端。
 * 图片由客户端以 FileUIPart（data URL）形式嵌入消息，convertToModelMessages 负责转换。
 */
export async function streamChat(
  rawMessages: unknown[],
  modelId?: string,
  signal?: AbortSignal,
) {
  const resolvedModel = resolveModel(modelId ?? process.env.AGENT_MODEL ?? "deepseek-v4-flash");

  // useChat 发来的是 UIMessage[]（有 parts/id），需转成 ModelMessage[]。
  const rawConverted = await convertToModelMessages(rawMessages as UIMessage[]);
  const messages = modelSupportsVision(modelId ?? "")
    ? rawConverted
    : stripImageParts(rawConverted);

  return streamText({
    model: resolvedModel,
    system: SYSTEM_PROMPT,
    messages,
    tools: buildTools(),
    stopWhen: stepCountIs(5),
    abortSignal: signal,
  });
}

function stripImageParts(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;
    type Part = { type?: string };
    const before = msg.content as Part[];
    const filtered = before.filter((p) => p.type !== "image" && p.type !== "file");
    if (filtered.length === before.length) return msg;
    // Always append the note — if we only keep user text without it, the model
    // sees "图片里面是什么" with no image and hallucinates a description.
    (filtered as unknown[]).push({ type: "text", text: "[注意：用户发送了图片，但当前模型不支持图像输入，请告知用户换用支持视觉的模型]" });
    return { ...msg, content: filtered } as ModelMessage;
  });
}
