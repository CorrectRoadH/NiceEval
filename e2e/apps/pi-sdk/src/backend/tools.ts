// 两个工具的真实实现：get_weather(city) 和 calculate(expression)，
// 包成 pi(@earendil-works/pi-agent-core)的 AgentTool——参数 schema 用 typebox
// (从 @earendil-works/pi-ai 重新导出的 Type/Static，不是 zod)，execute 签名是
// (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>。
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "@earendil-works/pi-ai";

export const WEATHER_TABLE: Record<string, { condition: string; tempC: number }> = {
  北京: { condition: "晴", tempC: 31 },
  上海: { condition: "多云", tempC: 29 },
  深圳: { condition: "雷阵雨", tempC: 33 },
  广州: { condition: "阵雨", tempC: 32 },
};

export function getWeather(city: string): { city: string; condition: string; tempC: number } {
  const known = WEATHER_TABLE[city];
  if (known) return { city, ...known };
  // 没收录的城市：按字符串哈希出一个确定性的假天气，保证同一个城市每次结果一致。
  let hash = 0;
  for (const ch of city) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const conditions = ["晴", "多云", "小雨", "阴"] as const;
  return { city, condition: conditions[hash % conditions.length]!, tempC: 15 + (hash % 20) };
}

export function calculate(expression: string): number {
  if (!/^[0-9+\-*/(). \s]+$/.test(expression)) {
    throw new Error(`calculate 只支持数字和 + - * / ( )，收到不支持的表达式: ${expression}`);
  }
  // eslint-disable-next-line no-new-func -- 输入已用白名单正则校验过，不会跑到任意代码。
  const value = Function(`"use strict"; return (${expression});`)() as unknown;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`表达式 ${expression} 没算出一个有限数字`);
  }
  return value;
}

const weatherParams = Type.Object({
  city: Type.String({ description: "城市名，例如 北京" }),
});

export const getWeatherTool: AgentTool<typeof weatherParams> = {
  name: "get_weather",
  label: "查询天气",
  description: "查询城市当前天气(mock 数据，仅用于演示，不接真实天气 API)",
  parameters: weatherParams,
  execute: async (_toolCallId, params: Static<typeof weatherParams>) => {
    const data = getWeather(params.city);
    return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
  },
};

const calculateParams = Type.Object({
  expression: Type.String({ description: "算术表达式，例如 (3+4)*2" }),
});

// 这个工具会经 server.ts 的 beforeToolCall 挂 HITL 审批，见 agent.ts / server.ts。
export const calculateTool: AgentTool<typeof calculateParams> = {
  name: "calculate",
  label: "算术计算",
  description: "计算一个只含数字和 + - * / ( ) 的算术表达式",
  parameters: calculateParams,
  execute: async (_toolCallId, params: Static<typeof calculateParams>) => {
    const result = calculate(params.expression);
    const data = { expression: params.expression, result };
    return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
  },
};
