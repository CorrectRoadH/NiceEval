// 两个工具的纯逻辑实现,包成 Claude Agent SDK `tool()` 形状导出。
// 天气数据是确定性模拟数据,不发起真实网络请求——这只是"假天气",跟真实的
// query() 调用(本仓库不允许的"假 AI")无关。
// 工具调用的输入输出不需要在这里旁路记录:SDK 的 message stream 里
// assistant 消息的 tool_use 块和 user 消息的 tool_result 块本身就带全了,
// server.ts 原样转发给前端即可。

import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

const WEATHER_TABLE: Record<string, { condition: string; tempC: number }> = {
  北京: { condition: "晴", tempC: 24 },
  上海: { condition: "多云", tempC: 27 },
  广州: { condition: "雷阵雨", tempC: 31 },
  深圳: { condition: "阵雨", tempC: 30 },
  杭州: { condition: "晴", tempC: 26 },
};

function getWeather(city: string): { city: string; condition: string; tempC: number } {
  const hit = WEATHER_TABLE[city];
  if (hit) return { city, ...hit };
  // 没收录的城市:用城市名派生一个确定性但看起来合理的读数。不发起真实网络请求。
  let hash = 0;
  for (const ch of city) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 997;
  const conditions = ["晴", "多云", "阴", "小雨"] as const;
  return { city, condition: conditions[hash % conditions.length]!, tempC: 15 + (hash % 18) };
}

/** 只接受数字、括号和 + - * / 的小型递归下降求值器 —— 不用 eval/Function,避免任意代码执行。 */
function calculate(expression: string): number {
  const trimmed = expression.trim();
  if (trimmed.length === 0) throw new Error("表达式不能为空");
  if (!/^[\d+\-*/().\s]+$/.test(trimmed)) {
    throw new Error(`表达式只能包含数字、+ - * / ( ):${expression}`);
  }

  let i = 0;
  const peek = (): string | undefined => trimmed[i];
  const skipSpace = (): void => {
    while (trimmed[i] === " ") i++;
  };

  function parseExpr(): number {
    skipSpace();
    let value = parseTerm();
    for (;;) {
      skipSpace();
      const op = peek();
      if (op !== "+" && op !== "-") break;
      i++;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    skipSpace();
    let value = parseFactor();
    for (;;) {
      skipSpace();
      const op = peek();
      if (op !== "*" && op !== "/") break;
      i++;
      const rhs = parseFactor();
      if (op === "/" && rhs === 0) throw new Error("除数不能为 0");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseFactor(): number {
    skipSpace();
    if (peek() === "+") {
      i++;
      return parseFactor();
    }
    if (peek() === "-") {
      i++;
      return -parseFactor();
    }
    if (peek() === "(") {
      i++;
      const value = parseExpr();
      skipSpace();
      if (peek() !== ")") throw new Error("括号不匹配");
      i++;
      return value;
    }
    const start = i;
    while (i < trimmed.length && /[\d.]/.test(trimmed[i]!)) i++;
    if (start === i) throw new Error(`表达式解析失败,位置 ${i}`);
    return Number(trimmed.slice(start, i));
  }

  const result = parseExpr();
  skipSpace();
  if (i !== trimmed.length) throw new Error(`表达式解析失败,位置 ${i}`);
  if (!Number.isFinite(result)) throw new Error("计算结果不是有限数");
  return result;
}

export const demoTools = [
  tool(
    "get_weather",
    "查询某个城市当前的天气状况(演示用的确定性模拟数据,不发起真实网络请求)。",
    { city: z.string().describe("城市名称,例如 北京") },
    async ({ city }) => {
      const result = getWeather(city);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  ),
  tool(
    "calculate",
    "计算一个只包含数字、+ - * / 和括号的算术表达式,返回数值结果。",
    { expression: z.string().describe("算术表达式,例如 (3 + 4) * 2") },
    async ({ expression }) => {
      try {
        const result = calculate(expression);
        return { content: [{ type: "text" as const, text: String(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `计算出错: ${message}` }], isError: true };
      }
    },
  ),
];
