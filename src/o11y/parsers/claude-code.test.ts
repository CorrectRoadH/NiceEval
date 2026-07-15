// cases: docs/engineering/unit-tests/adapters/cases.md
// claude-code transcript 解析器单测。
//
// 重点覆盖 Skill 加载识别(定稿见 docs/observability.md「OTLP traces → 统一瀑布图」、
// docs/concepts.md「标准事件流」词条:skill.loaded 是一等事件,不靠工具名/文本猜):
// 真实原生格式是 tool_use 块 name:"Skill"、input:{ skill:"<skill 名>", args?:"..." }
// (核对过 Claude Code CLI 自带的 SkillTool 定义,见 claude-code.ts 的 extractSkillName 头注)。
// 这里额外覆盖大小写、限定名、和「普通工具调用完全不受影响」的回归锁——skill.loaded 是
// 严格新增,不能改变任何非 Skill tool_use 的既有行为。

import { describe, expect, it } from "vitest";
import { parseClaudeCodeTranscript } from "./claude-code.ts";

const line = (obj: object): string => JSON.stringify(obj);

function toolUseLine(block: { id: string; name: string; input: object }) {
  return line({ type: "assistant", message: { content: [{ type: "tool_use", ...block }] } });
}

function toolResultLine(toolUseId: string, content: unknown, isError = false) {
  return line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: isError }] } });
}

describe("parseClaudeCodeTranscript — Skill 加载", () => {
  it("Skill tool_use 产出 skill.loaded(带 callId),不产出 action.called", () => {
    const raw = [
      toolUseLine({ id: "toolu_01", name: "Skill", input: { skill: "pdf" } }),
      toolResultLine("toolu_01", "PDF Processing\n\n## Quick start\n..."),
    ].join("\n");

    const { events } = parseClaudeCodeTranscript(raw);

    expect(events).toEqual([{ type: "skill.loaded", skill: "pdf", callId: "toolu_01" }]);
  });

  it("识别限定名(namespace:skill),原样作为 skill 字段透传", () => {
    const raw = toolUseLine({ id: "toolu_02", name: "Skill", input: { skill: "ms-office-suite:pdf" } });

    const { events } = parseClaudeCodeTranscript(raw);

    expect(events).toEqual([{ type: "skill.loaded", skill: "ms-office-suite:pdf", callId: "toolu_02" }]);
  });

  it("Skill 加载的 tool_result 被吃掉,不补发孤儿 action.result", () => {
    const raw = [
      toolUseLine({ id: "toolu_01", name: "Skill", input: { skill: "pdf" } }),
      toolResultLine("toolu_01", "skill body here"),
      line({ type: "assistant", message: { content: [{ type: "text", text: "done" }] } }),
    ].join("\n");

    const { events } = parseClaudeCodeTranscript(raw);

    expect(events.map((e) => e.type)).toEqual(["skill.loaded", "message"]);
    expect(events.some((e) => e.type === "action.result")).toBe(false);
  });

  it("input.skill 缺失或非字符串时不当作 Skill 加载,回落成普通 action.called", () => {
    const raw = [
      toolUseLine({ id: "toolu_04", name: "Skill", input: {} }),
      toolUseLine({ id: "toolu_05", name: "Skill", input: { skill: 42 } }),
    ].join("\n");

    const { events } = parseClaudeCodeTranscript(raw);

    expect(events).toEqual([
      { type: "action.called", callId: "toolu_04", name: "Skill", input: {}, tool: "unknown" },
      { type: "action.called", callId: "toolu_05", name: "Skill", input: { skill: 42 }, tool: "unknown" },
    ]);
  });

  it("Skill 加载与普通工具调用混合出现时,各自独立、顺序保持事件出现顺序", () => {
    const raw = [
      toolUseLine({ id: "t1", name: "Skill", input: { skill: "pdf" } }),
      toolResultLine("t1", "skill body"),
      toolUseLine({ id: "t2", name: "Read", input: { file_path: "/a.txt" } }),
      toolResultLine("t2", "file contents"),
    ].join("\n");

    const { events } = parseClaudeCodeTranscript(raw);

    expect(events).toEqual([
      { type: "skill.loaded", skill: "pdf", callId: "t1" },
      { type: "action.called", callId: "t2", name: "Read", input: { file_path: "/a.txt" }, tool: "file_read" },
      { type: "action.result", callId: "t2", output: "file contents", status: "completed" },
    ]);
  });

});

describe("parseClaudeCodeTranscript — 既有行为回归", () => {
  it("assistant 文本 + thinking + tool_use 混合一行时,三者按既有顺序全部产出", () => {
    const raw = line({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "checking files" },
          { type: "thinking", thinking: "should look at package.json" },
          { type: "tool_use", id: "c1", name: "Bash", input: { command: "cat package.json" } },
        ],
      },
    });

    const { events } = parseClaudeCodeTranscript(raw);

    expect(events).toEqual([
      { type: "message", role: "assistant", text: "checking files" },
      { type: "thinking", text: "should look at package.json" },
      { type: "action.called", callId: "c1", name: "Bash", input: { command: "cat package.json" }, tool: "shell" },
    ]);
  });

  it("失败的 tool_result(is_error)映射成 status: failed", () => {
    const raw = [
      toolUseLine({ id: "c1", name: "Bash", input: { command: "false" } }),
      toolResultLine("c1", "command failed", true),
    ].join("\n");

    const { events } = parseClaudeCodeTranscript(raw);

    expect(events[1]).toMatchObject({ type: "action.result", callId: "c1", status: "failed" });
  });

  it("compact_boundary 产出 compaction 事件并计数", () => {
    const raw = line({ type: "system", subtype: "compact_boundary" });
    const { events, compactions } = parseClaudeCodeTranscript(raw);
    expect(events).toEqual([{ type: "compaction" }]);
    expect(compactions).toBe(1);
  });

  it("空/未定义输入返回空事件流,不抛错", () => {
    expect(parseClaudeCodeTranscript(undefined).events).toEqual([]);
    expect(parseClaudeCodeTranscript("").events).toEqual([]);
    expect(parseClaudeCodeTranscript("   \n  \n").events).toEqual([]);
  });

  it("坏 JSON 行不中断解析,标 parseSuccess: false 但保留其余行的事件", () => {
    const raw = ["not json {{{", toolUseLine({ id: "c1", name: "Bash", input: {} })].join("\n");
    const { events, parseSuccess } = parseClaudeCodeTranscript(raw);
    expect(parseSuccess).toBe(false);
    expect(events).toEqual([{ type: "action.called", callId: "c1", name: "Bash", input: {}, tool: "shell" }]);
  });
});
