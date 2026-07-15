// cases: docs/engineering/unit-tests/adapters/cases.md
import { describe, expect, it } from "vitest";

import { fromChatCompletion, fromResponses } from "./openai-compat.ts";

describe("fromChatCompletion", () => {
  it("把 tool_calls + content 翻成 action.called + message,usage 顺手带上", () => {
    const turn = fromChatCompletion({
      choices: [
        {
          message: {
            role: "assistant",
            content: "Beijing is 21°C today.",
            tool_calls: [{ id: "c1", function: { name: "get_weather", arguments: '{"city":"Beijing"}' } }],
          },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 40 } },
    });

    expect(turn.status).toBe("completed");
    expect(turn.events).toEqual([
      { type: "action.called", callId: "c1", name: "get_weather", input: { city: "Beijing" } },
      { type: "message", role: "assistant", text: "Beijing is 21°C today." },
    ]);
    expect(turn.usage).toEqual({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 40 });
  });

  it("没有 tool_calls / content 时给空 events", () => {
    const turn = fromChatCompletion({ choices: [{ message: {} }] });
    expect(turn.events).toEqual([]);
    expect(turn.status).toBe("completed");
  });
});

describe("fromResponses", () => {
  it("把 function_call + message(output_text) 翻成对应事件", () => {
    const turn = fromResponses({
      output: [
        { type: "function_call", call_id: "c1", name: "get_weather", arguments: '{"city":"Beijing"}' },
        { type: "message", content: [{ type: "output_text", text: "Beijing is 21°C today." }] },
      ],
      usage: { input_tokens: 120, output_tokens: 30 },
    });

    expect(turn.events).toEqual([
      { type: "action.called", callId: "c1", name: "get_weather", input: { city: "Beijing" } },
      { type: "message", role: "assistant", text: "Beijing is 21°C today." },
    ]);
    expect(turn.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
  });

  it("认不出的 item 类型原样跳过,不抛异常", () => {
    const turn = fromResponses({ output: [{ type: "reasoning", summary: [] }] });
    expect(turn.events).toEqual([]);
  });
});
