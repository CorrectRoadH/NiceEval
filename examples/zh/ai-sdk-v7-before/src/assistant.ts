import { randomUUID } from "node:crypto";

interface SessionState {
  id: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

const sessions = new Map<string, SessionState>();

export function getSession(sessionId?: string): SessionState {
  const id = sessionId?.trim() || `assistant-${randomUUID()}`;
  const existing = sessions.get(id);
  if (existing) return existing;
  const next: SessionState = { id, messages: [] };
  sessions.set(id, next);
  return next;
}

const weatherBank: Record<string, { tempC: number; condition: string }> = {
  北京: { tempC: 26, condition: "晴" },
  上海: { tempC: 29, condition: "多云" },
  广州: { tempC: 32, condition: "雷阵雨" },
  深圳: { tempC: 31, condition: "阴" },
  杭州: { tempC: 28, condition: "小雨" },
};

export function getWeather(input: { city: string }): { city: string; tempC: number; condition: string; summary: string } {
  const weather = weatherBank[input.city] ?? { tempC: 24, condition: "晴" };
  return {
    city: input.city,
    tempC: weather.tempC,
    condition: weather.condition,
    summary: `${input.city}当前${weather.condition}，气温 ${weather.tempC}°C。`,
  };
}

const MATH_CHARS = /^[\d+\-*/().\s]+$/;

export function calculate(input: { expression: string }): { expression: string; result: number } {
  const expr = input.expression.trim();
  if (!MATH_CHARS.test(expr)) throw new Error(`只支持四则运算表达式，收到：${input.expression}`);
  const result = Function(`"use strict"; return (${expr});`)() as unknown;
  if (typeof result !== "number" || !Number.isFinite(result)) throw new Error(`无法计算：${input.expression}`);
  return { expression: expr, result };
}

export function webSearch(input: { query: string }): { query: string; results: Array<{ title: string; snippet: string }> } {
  return {
    query: input.query,
    results: [
      { title: `关于「${input.query}」的概览`, snippet: `这是与「${input.query}」最相关的一条摘要结果。` },
      { title: `「${input.query}」延伸阅读`, snippet: `进一步解释「${input.query}」的背景与常见问题。` },
    ],
  };
}

export function rememberAiTurn(session: SessionState, user: string, assistant: string): void {
  session.messages.push({ role: "user", content: user }, { role: "assistant", content: assistant });
}

export function sessionMessages(session: SessionState): Array<{ role: "user" | "assistant"; content: string }> {
  return session.messages.slice(-12);
}
