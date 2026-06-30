import { randomUUID } from "node:crypto";
import { generateText, streamText, stepCountIs, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod/v4";
import type { AgentEvent, AgentRequest, AgentResponse, AgentUsage, JsonValue, RequestFile } from "./protocol.ts";
import { createFastevalTrace } from "./fasteval-observability.ts";
import { calculate, getSession, getWeather, rememberAiTurn, sessionMessages, webSearch } from "./assistant.ts";
import { resolveModel } from "./models.ts";

const SYSTEM_PROMPT = `
你是一个乐于助人的中文 AI 助手。

规则：
1. 需要实时天气时，调用 get_weather，并用工具返回的数据作答；不要凭空编造天气。
2. 需要精确计算时，调用 calculate，把表达式交给它算，不要心算。
3. 需要查资料时，调用 web_search，基于返回结果作答。
4. 用户发来图片（消息里带图片）时，直接描述图片内容，不需要调用工具。
5. 普通闲聊不要调用任何工具。回复保持中文、友好、简洁。
`.trim();

function buildTools(
  record: <T extends JsonValue>(name: string, input: JsonValue, run: () => T) => T,
): ToolSet {
  return {
    get_weather: tool({
      description: "查询某个城市的当前天气。需要实时天气时调用。",
      inputSchema: z.object({ city: z.string().min(1) }),
      execute: async (input: { city: string }) => record("get_weather", { city: input.city }, () => getWeather(input)),
    }),
    calculate: tool({
      description: "计算一个四则运算表达式(支持 + - * / 和括号)。需要精确计算时调用。",
      inputSchema: z.object({ expression: z.string().min(1) }),
      execute: async (input: { expression: string }) =>
        record("calculate", { expression: input.expression }, () => calculate(input)),
    }),
    web_search: tool({
      description: "搜索网络获取资料摘要。需要查资料时调用。",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async (input: { query: string }) => record("web_search", { query: input.query }, () => webSearch(input)),
    }),
  };
}

// 无副作用版本的工具集，供 streamChat (UI 流式端点) 使用。
function buildSimpleTools(): ToolSet {
  const noop = <T extends JsonValue>(_name: string, _input: JsonValue, run: () => T): T => run();
  return buildTools(noop);
}

function makeRecorder(events: AgentEvent[]) {
  return function record<T extends JsonValue>(name: string, input: JsonValue, run: () => T): T {
    const callId = `${name}-${randomUUID()}`;
    events.push({ type: "action.called", callId, name, input, tool: "unknown" });
    try {
      const output = run();
      events.push({ type: "action.result", callId, output, status: "completed" });
      return output;
    } catch (error) {
      events.push({
        type: "action.result",
        callId,
        output: { error: error instanceof Error ? error.message : String(error) },
        status: "failed",
      });
      throw error;
    }
  };
}

/**
 * UI 流式端点：接受 useChat 发来的完整 messages 数组，直接 pipe 到客户端。
 * 调用方负责 pipeDataStreamToResponse。
 */
export function streamChat(
  rawMessages: unknown[],
  modelId?: string,
  images?: Array<{ mimeType: string; dataBase64: string }>,
  signal?: AbortSignal,
) {
  const resolvedModel = resolveModel(modelId ?? process.env.AGENT_MODEL ?? "gpt-4o-mini");

  // 把前端传来的 messages 当做 ModelMessage[]，如有图片则追加到最后一条 user 消息。
  let messages = rawMessages as ModelMessage[];
  if (images?.length) {
    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      const textContent = typeof last.content === "string" ? last.content : "";
      const textParts = typeof last.content === "string"
        ? [{ type: "text" as const, text: last.content }]
        : (Array.isArray(last.content) ? last.content : [{ type: "text" as const, text: textContent }]);
      messages = [
        ...messages.slice(0, -1),
        {
          role: "user",
          content: [
            ...textParts,
            ...images.map((img) => ({
              type: "image" as const,
              image: `data:${img.mimeType};base64,${img.dataBase64}`,
            })),
          ],
        },
      ];
    }
  }

  return streamText({
    model: resolvedModel,
    system: SYSTEM_PROMPT,
    messages,
    tools: buildSimpleTools(),
    stopWhen: stepCountIs(5),
    abortSignal: signal,
  });
}

/** eval adapter 用：等完整结果，返回 AgentResponse JSON。 */
export async function handleAiSdkTurn(request: AgentRequest, signal?: AbortSignal): Promise<AgentResponse> {
  const session = getSession(request.sessionId);
  const events: AgentEvent[] = [];
  const modelId = request.model ?? process.env.AGENT_MODEL ?? "gpt-4o-mini";
  const model = resolveModel(modelId);

  const trace = createFastevalTrace(request.otelEndpoint);
  const turn = trace.span("assistant.turn", { attrs: { "turn.id": session.id } });
  const modelSpan = trace.span(`chat ${modelId}`, {
    parent: turn,
    attrs: { "gen_ai.operation.name": "chat", "gen_ai.request.model": modelId },
  });

  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      messages: [...sessionMessages(session), userMessage(request.message, request.files)],
      tools: buildTools(makeRecorder(events)),
      stopWhen: stepCountIs(5),
      abortSignal: signal,
    });
  } catch (error) {
    modelSpan.end(undefined, { error: true });
    turn.end(undefined, { error: true });
    await trace.flush();
    throw error;
  }

  const usage = normalizeUsage(result);
  modelSpan.end(usageAttrs(usage));

  const reply = result.text.trim() || "我已经处理了这一步。";
  rememberAiTurn(session, request.message, reply);
  events.push({ type: "message", role: "assistant", text: reply });

  const lastAction = events.findLast((e) => e.type === "action.called")?.name ?? "chat";
  turn.end({ "assistant.last_action": lastAction });
  await trace.flush();

  return { sessionId: session.id, reply, events, data: { lastAction }, usage };
}

function userMessage(message: string, files?: RequestFile[]): ModelMessage {
  const images = (files ?? []).filter((f) => f.mimeType.startsWith("image/"));
  if (images.length === 0) return { role: "user", content: message };
  return {
    role: "user",
    content: [
      { type: "text", text: message || "请描述这张图片。" },
      ...images.map((f) => ({ type: "image" as const, image: `data:${f.mimeType};base64,${f.dataBase64}` })),
    ],
  };
}

function usageAttrs(usage: AgentUsage | undefined): Record<string, number> {
  if (!usage) return {};
  return {
    "gen_ai.usage.input_tokens": usage.inputTokens,
    "gen_ai.usage.output_tokens": usage.outputTokens,
  };
}

function normalizeUsage(result: unknown): AgentUsage | undefined {
  const rec = asRecord(result);
  if (!rec) return undefined;
  const usage = asRecord(rec.usage) ?? asRecord(rec.totalUsage) ?? rec;
  const inputTokens = numberField(usage.inputTokens) ?? numberField(usage.promptTokens) ?? 0;
  const outputTokens = numberField(usage.outputTokens) ?? numberField(usage.completionTokens) ?? 0;
  if (!inputTokens && !outputTokens) return undefined;
  return { inputTokens, outputTokens, requests: 1 };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
