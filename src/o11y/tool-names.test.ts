// cases: docs/engineering/unit-tests/adapters/cases.md
// 工具名归一的回归锁:canonical ToolName 是跨 agent 断言(calledTool("file_read"))
// 的命中基础。这里逐 agent 锁死关键映射,防止基表 / per-agent 差异表重构时悄悄漂移
// (曾发生:Claude Code 的裸名 Read/Write/Edit 在一次表合并中归一成了 "unknown")。

import { describe, it, expect } from "vitest";
import { normalizeToolName } from "./tool-names.ts";
import { CLAUDE_TOOL_ALIASES } from "./parsers/claude-code.ts";
import { CODEX_TOOL_ALIASES } from "./parsers/codex.ts";
import { BUB_TOOL_ALIASES } from "./parsers/bub.ts";

describe("normalizeToolName", () => {
  it("claude-code:PascalCase 核心工具全部命中", () => {
    const n = (name: string) => normalizeToolName(name, CLAUDE_TOOL_ALIASES);
    expect(n("Read")).toBe("file_read");
    expect(n("Write")).toBe("file_write");
    expect(n("Edit")).toBe("file_edit");
    expect(n("MultiEdit")).toBe("file_edit");
    expect(n("NotebookEdit")).toBe("file_edit");
    expect(n("Bash")).toBe("shell");
    expect(n("BashOutput")).toBe("shell");
    expect(n("WebFetch")).toBe("web_fetch");
    expect(n("WebSearch")).toBe("web_search");
    expect(n("Glob")).toBe("glob");
    expect(n("Grep")).toBe("grep");
    expect(n("LS")).toBe("list_dir");
    expect(n("Task")).toBe("agent_task");
  });

  it("codex:裸动词与专属名命中", () => {
    const n = (name: string) => normalizeToolName(name, CODEX_TOOL_ALIASES);
    expect(n("exec")).toBe("shell");
    expect(n("local_shell")).toBe("shell");
    expect(n("apply_patch")).toBe("file_edit");
    expect(n("file_change")).toBe("file_edit");
    expect(n("update_plan")).toBe("agent_task");
    expect(n("web_search")).toBe("web_search");
  });

  it("bub:fs.* 命名空间与裸名命中", () => {
    const n = (name: string) => normalizeToolName(name, BUB_TOOL_ALIASES);
    expect(n("fs.read")).toBe("file_read");
    expect(n("fs_write")).toBe("file_write");
    expect(n("edit")).toBe("file_edit");
    expect(n("bash")).toBe("shell");
    expect(n("update_todos")).toBe("agent_task");
  });

  it("无 overrides(AI SDK 应用):域内可能撞名的裸动词不误归一", () => {
    // 被测应用完全可能有叫 search / run / fetch / task 的域内工具;
    // 它们必须落 "unknown",否则 notCalledTool("web_search") 这类断言语义被悄悄改写。
    expect(normalizeToolName("search")).toBe("unknown");
    expect(normalizeToolName("run")).toBe("unknown");
    expect(normalizeToolName("fetch")).toBe("unknown");
    expect(normalizeToolName("task")).toBe("unknown");
    expect(normalizeToolName("get_weather")).toBe("unknown");
    // 但明确的复合名照常命中。
    expect(normalizeToolName("read_file")).toBe("file_read");
    expect(normalizeToolName("execute_command")).toBe("shell");
    expect(normalizeToolName("web_search")).toBe("web_search");
  });
});
