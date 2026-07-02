// 两个工具的纯函数实现:get_weather(city) 和 calculate(expression)。
// 经 LangChain 的 tool() 包一层给 createAgent 用。
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const KNOWN_CITIES: Record<string, { condition: string; tempC: number }> = {
  北京: { condition: "晴", tempC: 26 },
  上海: { condition: "多云", tempC: 29 },
  广州: { condition: "雷阵雨", tempC: 32 },
  深圳: { condition: "阴", tempC: 31 },
  杭州: { condition: "小雨", tempC: 28 },
};

const CONDITIONS = ["晴", "多云", "阴", "小雨", "雷阵雨"];

export interface WeatherResult {
  city: string;
  condition: string;
  tempC: number;
  summary: string;
}

/**
 * 查天气,演示用固定数据,不接外部 API。已知城市查表;未知城市按名字算一个
 * 确定性伪随机结果——同一个城市名永远得到同一个答案,方便复现和写断言。
 */
export function getWeather(city: string): WeatherResult {
  const key = city.trim();
  const known = KNOWN_CITIES[key];
  const weather =
    known ??
    (() => {
      const seed = [...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
      return { condition: CONDITIONS[seed % CONDITIONS.length], tempC: 15 + (seed % 18) };
    })();
  return { city: key, ...weather, summary: `${key}当前${weather.condition},气温 ${weather.tempC}°C。` };
}

/**
 * 只支持数字、+ - * / ( ) 的递归下降解析器——不用 eval()/Function(),
 * 输入里混进非法字符会直接抛错,而不是被当成代码执行。
 */
export function calculate(expression: string): number {
  if (!/^[\d\s+\-*/().]+$/.test(expression)) {
    throw new Error(`表达式只能包含数字和 + - * / ( ):收到 "${expression}"`);
  }

  let pos = 0;
  const peek = (): string | undefined => expression[pos];
  const skipSpaces = (): void => {
    while (peek() === " ") pos++;
  };

  function parseNumber(): number {
    skipSpaces();
    const start = pos;
    while (peek() !== undefined && /[\d.]/.test(peek()!)) pos++;
    if (pos === start) throw new Error(`表达式在位置 ${pos} 处缺少数字:"${expression}"`);
    return Number(expression.slice(start, pos));
  }

  function parseFactor(): number {
    skipSpaces();
    if (peek() === "(") {
      pos++;
      const value = parseExpr();
      skipSpaces();
      if (peek() !== ")") throw new Error(`表达式缺少右括号:"${expression}"`);
      pos++;
      return value;
    }
    if (peek() === "-") {
      pos++;
      return -parseFactor();
    }
    return parseNumber();
  }

  function parseTerm(): number {
    let value = parseFactor();
    for (;;) {
      skipSpaces();
      const op = peek();
      if (op === "*" || op === "/") {
        pos++;
        const rhs = parseFactor();
        value = op === "*" ? value * rhs : value / rhs;
      } else {
        return value;
      }
    }
  }

  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      skipSpaces();
      const op = peek();
      if (op === "+" || op === "-") {
        pos++;
        const rhs = parseTerm();
        value = op === "+" ? value + rhs : value - rhs;
      } else {
        return value;
      }
    }
  }

  const result = parseExpr();
  skipSpaces();
  if (pos !== expression.length) {
    throw new Error(`表达式在位置 ${pos} 处有多余字符:"${expression}"`);
  }
  return result;
}

export const getWeatherTool = tool(async ({ city }: { city: string }) => JSON.stringify(getWeather(city)), {
  name: "get_weather",
  description: "查询某个城市当前的天气(演示用固定数据,不接外部 API)。需要实时天气时调用。",
  schema: z.object({ city: z.string().min(1).describe("城市名,例如 北京") }),
});

export const calculateTool = tool(
  async ({ expression }: { expression: string }) => JSON.stringify({ expression, result: calculate(expression) }),
  {
    name: "calculate",
    description: "计算一个只含数字和 + - * / ( ) 的算术表达式。需要精确计算时调用,不要心算。",
    schema: z.object({ expression: z.string().min(1) }),
  },
);

export const agentTools = [getWeatherTool, calculateTool];
