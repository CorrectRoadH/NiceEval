import { describe, it, expect } from "vitest";
import type { TraceSpan } from "../../types.ts";
import { deriveEventsFromSpans, mergeDerivedEvents, genAi, aiSdk, codex, openInference, openLLMetry, langsmith } from "./dialects.ts";

let seq = 0;
function span(name: string, attributes: Record<string, unknown>, opts: Partial<TraceSpan> = {}): TraceSpan {
  seq += 1;
  return {
    traceId: "t1",
    spanId: `s${seq}`,
    name,
    startMs: 1000 + seq * 10,
    endMs: 1000 + seq * 10 + 5,
    status: "ok",
    attributes: attributes as TraceSpan["attributes"],
    ...opts,
  };
}

describe("genAi 方言", () => {
  it("execute_tool span → action.called + action.result(入参出参 JSON 解析)", () => {
    const d = deriveEventsFromSpans([
      span("execute_tool get_weather", {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "get_weather",
        "gen_ai.tool.call.id": "call_1",
        "gen_ai.tool.call.arguments": '{"city":"北京"}',
        "gen_ai.tool.call.result": '{"temp":21}',
      }),
    ]);
    expect(d.events).toEqual([
      { type: "action.called", callId: "call_1", name: "get_weather", input: { city: "北京" } },
      { type: "action.result", callId: "call_1", output: { temp: 21 }, status: "completed" },
    ]);
    expect(d.recognized).toEqual({ genAi: 2 - 1 }); // 一条 span 计一次
  });

  it("chat span → usage 聚合 + output.messages 抠 assistant 文本", () => {
    const d = deriveEventsFromSpans([
      span("chat gpt-4o", {
        "gen_ai.operation.name": "chat",
        "gen_ai.usage.input_tokens": 120,
        "gen_ai.usage.output_tokens": 30,
        "gen_ai.output.messages": '[{"role":"assistant","parts":[{"type":"text","content":"今天晴"}]}]',
      }),
      span("chat gpt-4o", {
        "gen_ai.operation.name": "chat",
        "gen_ai.usage.input_tokens": 80,
        "gen_ai.usage.output_tokens": 20,
      }),
    ]);
    expect(d.usage).toEqual({ inputTokens: 200, outputTokens: 50 });
    expect(d.events).toEqual([{ type: "message", role: "assistant", text: "今天晴" }]);
  });

  it("span status=error → action.result failed", () => {
    const d = deriveEventsFromSpans([
      span(
        "execute_tool boom",
        { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "boom", "gen_ai.tool.call.id": "c9" },
        { status: "error" },
      ),
    ]);
    expect(d.events[1]).toMatchObject({ type: "action.result", callId: "c9", status: "failed" });
  });
});

describe("aiSdk 方言(legacy ai.*)", () => {
  it("ai.toolCall → 工具对;ai.generateText → 文本 + usage(不从 doGenerate 双计)", () => {
    const d = deriveEventsFromSpans([
      span("ai.generateText", {
        "operation.name": "ai.generateText",
        "ai.response.text": "答案是 42",
        "ai.usage.promptTokens": 10,
        "ai.usage.completionTokens": 5,
      }),
      span("ai.generateText.doGenerate", {
        "operation.name": "ai.generateText.doGenerate",
        "ai.usage.promptTokens": 10,
        "ai.usage.completionTokens": 5,
      }),
      span("ai.toolCall", {
        "operation.name": "ai.toolCall",
        "ai.toolCall.name": "calculate",
        "ai.toolCall.id": "tc1",
        "ai.toolCall.args": '{"a":1}',
        "ai.toolCall.result": "2",
      }),
    ]);
    expect(d.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(d.events).toContainEqual({ type: "action.called", callId: "tc1", name: "calculate", input: { a: 1 } });
    expect(d.events).toContainEqual({ type: "message", role: "assistant", text: "答案是 42" });
  });
});

describe("openInference 方言", () => {
  it("TOOL / LLM span 派生", () => {
    const d = deriveEventsFromSpans([
      span("lookup_order", {
        "openinference.span.kind": "TOOL",
        "tool.name": "lookup_order",
        "tool_call.id": "oc1",
        "input.value": '{"orderId":"42"}',
        "output.value": '{"status":"shipped"}',
      }),
      span("ChatOpenAI", {
        "openinference.span.kind": "LLM",
        "llm.output_messages.0.message.role": "assistant",
        "llm.output_messages.0.message.content": "已发货",
        "llm.token_count.prompt": 7,
        "llm.token_count.completion": 3,
      }),
    ]);
    expect(d.events).toEqual([
      { type: "action.called", callId: "oc1", name: "lookup_order", input: { orderId: "42" } },
      { type: "action.result", callId: "oc1", output: { status: "shipped" }, status: "completed" },
      { type: "message", role: "assistant", text: "已发货" },
    ]);
    expect(d.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });
});

describe("openLLMetry 方言", () => {
  it("traceloop tool span + 索引式 completion", () => {
    const d = deriveEventsFromSpans([
      span("calculate.tool", {
        "traceloop.span.kind": "tool",
        "traceloop.entity.name": "calculate",
        "traceloop.entity.input": '{"a":2,"b":3}',
        "traceloop.entity.output": "5",
      }),
      span("openai.chat", {
        "gen_ai.completion.0.role": "assistant",
        "gen_ai.completion.0.content": "等于 5",
        "gen_ai.usage.prompt_tokens": 11,
        "gen_ai.usage.completion_tokens": 4,
      }),
    ]);
    expect(d.events).toContainEqual({ type: "action.called", callId: expect.any(String), name: "calculate", input: { a: 2, b: 3 } });
    expect(d.events).toContainEqual({ type: "message", role: "assistant", text: "等于 5" });
    expect(d.usage).toEqual({ inputTokens: 11, outputTokens: 4 });
  });
});

describe("langsmith 方言", () => {
  it("tool / llm span 派生", () => {
    const d = deriveEventsFromSpans([
      span("get_weather", {
        "langsmith.span.kind": "tool",
        "gen_ai.prompt": '{"city":"上海"}',
        "gen_ai.completion": '"多云 18 度"',
      }),
      span("ChatOpenAI", {
        "langsmith.span.kind": "llm",
        "gen_ai.completion": "上海多云,18 度。",
        "gen_ai.usage.input_tokens": 9,
        "gen_ai.usage.output_tokens": 6,
      }),
    ]);
    expect(d.events[0]).toMatchObject({ type: "action.called", name: "get_weather", input: { city: "上海" } });
    expect(d.events[2]).toEqual({ type: "message", role: "assistant", text: "上海多云,18 度。" });
    expect(d.usage).toEqual({ inputTokens: 9, outputTokens: 6 });
  });
});

describe("codex 方言(codex CLI 原生 OTLP,属性形状按 codex 0.142 实测)", () => {
  it("真实执行 span(tool_name + call_id)→ 工具对;处理骨架(无 call_id)认领但不派生", () => {
    const d = deriveEventsFromSpans([
      // 处理骨架:也标着 execute_tool,但没有 call_id —— 不该派生
      span("handle_tool_call", {
        target: "codex_core::tools::parallel",
        "gen_ai.operation.name": "execute_tool",
      }),
      span("handle_responses", {
        target: "codex_core::session::turn",
        tool_name: "exec_command",
        "gen_ai.operation.name": "execute_tool",
      }),
      // 真实执行
      span("exec_command", {
        target: "codex_core::tools::parallel",
        tool_name: "exec_command",
        call_id: "call_abc",
        aborted: false,
        "gen_ai.operation.name": "execute_tool",
      }),
    ]);
    expect(d.events).toEqual([
      { type: "action.called", callId: "call_abc", name: "exec_command", input: null },
      { type: "action.result", callId: "call_abc", status: "completed" },
    ]);
    expect(d.recognized).toEqual({ codex: 3 });
  });

  it("session_task.turn 的 codex.turn.token_usage.* → usage", () => {
    const d = deriveEventsFromSpans([
      span("session_task.turn", {
        target: "codex_core::tasks",
        model: "gpt-5.4",
        "codex.turn.token_usage.input_tokens": 20788,
        "codex.turn.token_usage.output_tokens": 12,
      }),
    ]);
    expect(d.usage).toEqual({ inputTokens: 20788, outputTokens: 12 });
  });

  it("aborted=true / status=error → failed", () => {
    const d = deriveEventsFromSpans([
      span("exec_command", { target: "codex_core::tools::parallel", tool_name: "exec_command", call_id: "c1", aborted: true }),
      span(
        "apply_patch",
        { target: "codex_core::tools::parallel", tool_name: "apply_patch", call_id: "c2" },
        { status: "error" },
      ),
    ]);
    expect(d.events.filter((e) => e.type === "action.result").map((e) => (e as { status: string }).status)).toEqual([
      "failed",
      "failed",
    ]);
  });

  it("必须先于 genAi 认领:codex 的 chat 骨架 span 不产生假事件,也不算 unrecognized", () => {
    // codex 模型 span 也带 gen_ai.operation.name=chat,但没有 usage / 文本;
    // 若被 genAi 认领虽也无事件,但 execute_tool 骨架会冒出假工具对 —— 全表顺序保证 codex 先。
    const d = deriveEventsFromSpans([
      span("model_client.stream_responses_api", {
        target: "codex_core::client",
        wire_api: "responses",
        "gen_ai.operation.name": "chat",
      }),
      span("dispatch_tool_call_with_terminal_outcome", {
        target: "codex_core::tools::router",
        "gen_ai.operation.name": "execute_tool",
      }),
    ]);
    expect(d.events).toEqual([]);
    expect(d.recognized).toEqual({ codex: 2 });
    expect(d.unrecognized).toEqual([]);
  });
});

describe("自动识别与摘要", () => {
  it("混合流各认各的;未识别的 span 名收进 unrecognized", () => {
    const d = deriveEventsFromSpans([
      span("chat m", { "gen_ai.operation.name": "chat" }),
      span("ai.toolCall", { "ai.toolCall.name": "t", "ai.toolCall.id": "x" }),
      span("internal.plumbing", { whatever: 1 }),
    ]);
    expect(d.recognized).toEqual({ genAi: 1, aiSdk: 1 });
    expect(d.unrecognized).toEqual(["internal.plumbing"]);
  });

  it("显式钉方言:只用传入的方言表", () => {
    const d = deriveEventsFromSpans(
      [span("ai.toolCall", { "ai.toolCall.name": "t", "ai.toolCall.id": "x" })],
      [genAi],
    );
    expect(d.recognized).toEqual({});
    expect(d.unrecognized).toEqual(["ai.toolCall"]);
  });

  it("事件按 span startMs 排序(eventOrder 天然成立)", () => {
    const late = span("execute_tool b", {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "b",
      "gen_ai.tool.call.id": "c2",
    });
    const early = { ...span("execute_tool a", {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "a",
      "gen_ai.tool.call.id": "c1",
    }), startMs: 1, endMs: 2 };
    const d = deriveEventsFromSpans([late, early]);
    expect(d.events.filter((e) => e.type === "action.called").map((e) => (e as { name: string }).name)).toEqual(["a", "b"]);
  });
});

describe("mergeDerivedEvents", () => {
  it("adapter 已给的 callId / 消息不重复;派生的补充在前", () => {
    const merged = mergeDerivedEvents(
      [
        { type: "action.called", callId: "dup", name: "x", input: null },
        { type: "action.result", callId: "dup", status: "completed" },
        { type: "message", role: "assistant", text: "final" },
      ],
      [
        { type: "action.called", callId: "dup", name: "x", input: null },
        { type: "action.result", callId: "dup", status: "completed" },
        { type: "action.called", callId: "extra", name: "y", input: null },
        { type: "action.result", callId: "extra", status: "completed" },
        { type: "message", role: "assistant", text: "final" },
      ],
    );
    expect(merged).toEqual([
      { type: "action.called", callId: "extra", name: "y", input: null },
      { type: "action.result", callId: "extra", status: "completed" },
      { type: "action.called", callId: "dup", name: "x", input: null },
      { type: "action.result", callId: "dup", status: "completed" },
      { type: "message", role: "assistant", text: "final" },
    ]);
  });
});

// 方言可以自定义传入(OtelDialect 是公开契约)
describe("自定义方言", () => {
  it("私有埋点与官方方言混用", () => {
    const mine = {
      name: "acme",
      matches: (s: TraceSpan) => s.name.startsWith("acme."),
      derive: (s: TraceSpan) => ({
        events: [
          { type: "action.called" as const, callId: s.spanId, name: "acme_tool", input: null },
          { type: "action.result" as const, callId: s.spanId, status: "completed" as const },
        ],
      }),
    };
    const d = deriveEventsFromSpans(
      [span("acme.tool_run", {}), span("chat m", { "gen_ai.operation.name": "chat" })],
      [mine, genAi],
    );
    expect(d.recognized).toEqual({ acme: 1, genAi: 1 });
  });
});

// 官方方言对象本身可独立引用(otel.* 命名空间的成员)
it("官方方言命名齐全", () => {
  expect([genAi.name, codex.name, aiSdk.name, openInference.name, openLLMetry.name, langsmith.name]).toEqual([
    "genAi",
    "codex",
    "aiSdk",
    "openInference",
    "openLLMetry",
    "langsmith",
  ]);
});
