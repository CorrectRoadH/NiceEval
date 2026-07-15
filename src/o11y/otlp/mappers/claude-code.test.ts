// cases: docs/engineering/unit-tests/adapters/cases.md
// mapClaudeCodeSpans:span 形状取自真实运行(claude CLI 2.1.202 beta 遥测,E2B 实测)。

import { describe, expect, it } from "vitest";
import type { TraceSpan } from "../../../types.ts";
import { mapClaudeCodeSpans } from "./claude-code.ts";

function span(name: string, attributes?: TraceSpan["attributes"]): TraceSpan {
  return { traceId: "t", spanId: name, name, startMs: 0, endMs: 1, attributes };
}

describe("mapClaudeCodeSpans", () => {
  it("interaction 归 turn,自带标准 op 的 span 交给 heuristic 定 kind", () => {
    const mapped = mapClaudeCodeSpans([
      span("claude_code.interaction", { "session.id": "s1" }),
      span("claude_code.llm_request", { "gen_ai.operation.name": "chat", model: "m" }),
      span("claude_code.tool", { "gen_ai.operation.name": "execute_tool", tool_name: "Bash" }),
    ]);
    expect(mapped.map((s) => s.kind)).toEqual(["turn", "model", "tool"]);
  });

  it("tool_use_id 复制成 call_id 供 I/O join;已有 call_id 的不覆盖", () => {
    const mapped = mapClaudeCodeSpans([
      span("claude_code.tool", { "gen_ai.operation.name": "execute_tool", tool_use_id: "toolu_1" }),
      span("claude_code.tool", { "gen_ai.operation.name": "execute_tool", tool_use_id: "toolu_2", call_id: "keep" }),
      span("claude_code.hook", {}),
    ]);
    expect(mapped[0].attributes?.call_id).toBe("toolu_1");
    expect(mapped[1].attributes?.call_id).toBe("keep");
    expect(mapped[2].attributes?.call_id).toBeUndefined();
  });
});
