// 被测助手:系统提示 + 四个工具 + 一个 generate。这里只有【应用自己的事】——
// 会话、事件流、HITL 握手、失败兜底全部由 niceeval 内建的 aiSdkAgent 工厂承担,
// 实验里 `aiSdkAgent(assistant)` 一行接线(见 experiments/)。
//
// 工具本体不掺任何记录逻辑 —— 事件流由 fromAiSdk 从 generateText 结果里直接取
// (AI SDK 原生带 toolCallId,不必包 recorder)。
//
// send_email 带 `needsApproval: true`(AI SDK v7 的 tool approval):模型决定调它时
// SDK 会停下来等人批准 —— 这正是 niceeval HITL(t.requireInputRequest / t.respond)
// 要测的那类交互。
import { generateText, isStepCount, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import type { AiSdkAgentOptions } from "niceeval/adapter";
import { DEFAULT_MODEL, resolveModel } from "./models.ts";
import { createOtlpTrace } from "./otlp.ts";

export const SYSTEM_PROMPT = `
你是一个乐于助人的中文 AI 助手。

规则:
1. 需要实时天气时,调用 get_weather,并用工具返回的数据作答;不要凭空编造天气。
2. 需要精确计算时,调用 calculate,把表达式交给它算,不要心算。
3. 需要查资料时,调用 web_search,基于返回结果作答。
4. 用户要求发送邮件时,调用 send_email;邮件发出(或被拒绝)后如实告知用户结果。
5. 普通闲聊不要调用任何工具。回复保持中文、友好、简洁。
`.trim();

const weatherBank: Record<string, { tempC: number; condition: string }> = {
  北京: { tempC: 26, condition: "晴" },
  上海: { tempC: 29, condition: "多云" },
  广州: { tempC: 32, condition: "雷阵雨" },
  深圳: { tempC: 31, condition: "阴" },
  杭州: { tempC: 28, condition: "小雨" },
};

const MATH_CHARS = /^[\d+\-*/().\s]+$/;

export function buildTools(): ToolSet {
  return {
    get_weather: tool({
      description: "查询某个城市的当前天气。需要实时天气时调用。",
      inputSchema: z.object({ city: z.string().min(1) }),
      execute: async ({ city }) => {
        const weather = weatherBank[city] ?? { tempC: 24, condition: "晴" };
        return { city, ...weather, summary: `${city}当前${weather.condition},气温 ${weather.tempC}°C。` };
      },
    }),
    calculate: tool({
      description: "计算一个四则运算表达式(支持 + - * / 和括号)。需要精确计算时调用。",
      inputSchema: z.object({ expression: z.string().min(1) }),
      execute: async ({ expression }) => {
        const expr = expression.trim();
        if (!MATH_CHARS.test(expr)) throw new Error(`只支持四则运算表达式,收到:${expression}`);
        const result = Function(`"use strict"; return (${expr});`)() as unknown;
        if (typeof result !== "number" || !Number.isFinite(result)) throw new Error(`无法计算:${expression}`);
        return { expression: expr, result };
      },
    }),
    web_search: tool({
      description: "搜索网络获取资料摘要。需要查资料时调用。",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => ({
        query,
        results: [
          { title: `关于「${query}」的概览`, snippet: `这是与「${query}」最相关的一条摘要结果。` },
          { title: `「${query}」延伸阅读`, snippet: `进一步解释「${query}」的背景与常见问题。` },
        ],
      }),
    }),
    send_email: tool({
      description: "把一封邮件发送给指定收件人。用户要求发邮件时调用。",
      inputSchema: z.object({
        to: z.string().min(1).describe("收件人邮箱"),
        subject: z.string().min(1).describe("邮件主题"),
        body: z.string().min(1).describe("邮件正文"),
      }),
      // 对外发东西是高危动作:要求人工批准。模型决定调用后,本轮 generateText 会带着
      // tool-approval-request 停下,等下一轮把 tool-approval-response 塞回 messages。
      needsApproval: true,
      execute: async ({ to, subject }) => ({ delivered: true, to, subject, messageId: `msg-${to}` }),
    }),
  };
}

/**
 * 内建 aiSdkAgent 工厂的配置:应用只写「怎么召模型」(generate)和「结构化输出取什么」(data)。
 * messages 历史由工厂管理(含 HITL 的 tool-approval-response),这里原样透传给 generateText。
 */
export const assistant: AiSdkAgentOptions<ModelMessage> = {
  name: "ai-sdk-v7",
  // T3 tracing:声明后 niceeval 起本机 OTLP 接收器,端点经 generate 的 telemetry 进来。
  capabilities: { tracing: true },

  async generate({ messages, model, signal, telemetry }) {
    const modelId = model ?? process.env.AGENT_MODEL ?? DEFAULT_MODEL;
    const trace = createOtlpTrace(telemetry?.endpoint);
    const turnSpan = trace.span("assistant.turn");
    const modelSpan = trace.span(`chat ${modelId}`, {
      parent: turnSpan,
      attrs: { "gen_ai.operation.name": "chat", "gen_ai.request.model": modelId },
    });

    try {
      const result = await generateText({
        model: resolveModel(modelId),
        system: SYSTEM_PROMPT,
        messages,
        tools: buildTools(),
        stopWhen: isStepCount(5),
        abortSignal: signal,
      });
      modelSpan.end({
        "gen_ai.usage.input_tokens": result.usage.inputTokens ?? 0,
        "gen_ai.usage.output_tokens": result.usage.outputTokens ?? 0,
      });
      turnSpan.end();
      return result;
    } catch (error) {
      modelSpan.end(undefined, { error: true });
      turnSpan.end(undefined, { error: true });
      throw error; // 工厂把它兜成 status:"failed" 的 Turn
    } finally {
      await trace.flush();
    }
  },

  // T0 结构化输出(Turn.data):最终回复 + 本轮最后一个动作(evals 里 outputMatches 用)。
  data: (result, turn) => ({
    reply: result.text ?? "",
    lastAction:
      [...turn.events].reverse().find((e) => e.type === "action.called")?.name ?? "chat",
  }),
};
