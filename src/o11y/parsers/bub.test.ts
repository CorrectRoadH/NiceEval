// bub tape 解析回归锁。
//
// 背景(2026-07 实测):模型在同一步里「先说话再调工具」时,bub 的 tape 把伴随文本
// 记在 tool_call 条目的 payload.content 上(修复前上游直接丢弃,transcript 里
// 每次 send 后面都看不到 AI 回复 —— 只有最后一步纯文本收尾能出现)。
// 解析器必须把这段文本还原成 assistant message 事件,且顺序在 action.called 之前。

import { describe, it, expect } from "vitest";
import { parseBubTranscript } from "./bub.ts";

const line = (obj: object) => JSON.stringify(obj);

describe("parseBubTranscript", () => {
  it("tool_call 携带 payload.content 时,先 emit assistant message 再 emit action.called", () => {
    const raw = [
      line({ kind: "message", payload: { role: "user", content: "migrate the routes" } }),
      line({
        kind: "tool_call",
        payload: {
          content: "I'll start by listing the pages directory.",
          calls: [
            { id: "call_1", type: "function", function: { name: "bash", arguments: '{"cmd":"ls pages"}' } },
          ],
        },
      }),
      line({ kind: "tool_result", payload: { results: ["index.js\nabout.js"] } }),
    ].join("\n");

    const { events } = parseBubTranscript(raw);
    const types = events.map((e) => e.type);
    expect(types).toEqual(["message", "message", "action.called", "action.result"]);

    const assistant = events[1];
    expect(assistant).toMatchObject({
      type: "message",
      role: "assistant",
      text: "I'll start by listing the pages directory.",
    });

    const call = events[2];
    expect(call).toMatchObject({ type: "action.called", callId: "call_1", name: "bash", tool: "shell" });
  });

  it("tool_call 无 content(存量 tape)不产生幻影 assistant message", () => {
    const raw = [
      line({ kind: "message", payload: { role: "user", content: "do it" } }),
      line({
        kind: "tool_call",
        payload: { calls: [{ id: "call_1", function: { name: "fs_read", arguments: '{"path":"a.ts"}' } }] },
      }),
      line({ kind: "tool_result", payload: { results: ["file body"] } }),
    ].join("\n");

    const { events } = parseBubTranscript(raw);
    expect(events.map((e) => e.type)).toEqual(["message", "action.called", "action.result"]);
  });

  it("tool_call 的 content 为块数组时也能抽出文本", () => {
    const raw = line({
      kind: "tool_call",
      payload: {
        content: [{ type: "text", text: "Checking the config first." }],
        calls: [{ id: "call_1", function: { name: "bash", arguments: "{}" } }],
      },
    });

    const { events } = parseBubTranscript(raw);
    expect(events[0]).toMatchObject({ type: "message", role: "assistant", text: "Checking the config first." });
    expect(events[1]).toMatchObject({ type: "action.called", callId: "call_1" });
  });
});
