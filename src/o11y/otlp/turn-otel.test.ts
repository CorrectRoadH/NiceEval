// cases: docs/engineering/unit-tests/adapters/cases.md
import { describe, it, expect } from "vitest";
import type { TraceSpan } from "../../types.ts";
import type { TraceReceiver } from "./receiver.ts";
import { AgentOtelChannel } from "./turn-otel.ts";

let seq = 0;
function span(traceId: string, startMs = Date.now()): TraceSpan {
  seq += 1;
  return { traceId, spanId: `s${seq}`, name: `op${seq}`, startMs, endMs: startMs + 1 };
}

function fakeReceiver(): TraceReceiver & { push(s: TraceSpan): void } {
  const spans: TraceSpan[] = [];
  return {
    push: (s) => spans.push(s),
    endpoint: (host) => `http://${host}:0/v1/traces`,
    collect: () => spans.slice(),
    settle: async () => {},
    close: async () => {},
  };
}

describe("AgentOtelChannel 归属", () => {
  it("traceparent 命中:按 traceId 归属并确认(解除串行)", async () => {
    const r = fakeReceiver();
    const ch = new AgentOtelChannel(r);
    expect(ch.serialized).toBe(true);
    const turn = await ch.runTurn(async (headers) => {
      const traceId = headers.traceparent.split("-")[1];
      r.push(span(traceId));
      r.push(span("someone-else"));
      return "ok";
    });
    expect(turn.result).toBe("ok");
    expect(turn.attribution).toBe("traceparent");
    expect(turn.spans).toHaveLength(1);
    expect(ch.serialized).toBe(false);
  });

  it("无 traceparent:窗口归属拿走全部未消费 span,且不重复分给下一轮", async () => {
    const r = fakeReceiver();
    const ch = new AgentOtelChannel(r);
    const t1 = await ch.runTurn(async () => {
      r.push(span("app-trace-a"));
      r.push(span("app-trace-a"));
      return 1;
    });
    expect(t1.attribution).toBe("window");
    expect(t1.spans).toHaveLength(2);

    const t2 = await ch.runTurn(async () => {
      r.push(span("app-trace-b"));
      return 2;
    });
    expect(t2.spans).toHaveLength(1);
    expect(t2.spans[0].traceId).toBe("app-trace-b");
  });

  it("未确认前轮次串行:窗口不重叠", async () => {
    const r = fakeReceiver();
    const ch = new AgentOtelChannel(r);
    const order: string[] = [];
    const p1 = ch.runTurn(async () => {
      order.push("a-start");
      await new Promise((res) => setTimeout(res, 30));
      r.push(span("x"));
      order.push("a-end");
      return "a";
    });
    const p2 = ch.runTurn(async () => {
      order.push("b-start");
      r.push(span("y"));
      return "b";
    });
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
    expect(t1.spans.map((s) => s.traceId)).toEqual(["x"]);
    expect(t2.spans.map((s) => s.traceId)).toEqual(["y"]);
  });

  it("确认后只按 traceId 归属,不回退窗口(并发不混流)", async () => {
    const r = fakeReceiver();
    const ch = new AgentOtelChannel(r);
    await ch.runTurn(async (headers) => {
      r.push(span(headers.traceparent.split("-")[1]));
      return 0;
    });
    // 应用这轮丢了 traceparent → 0 归属,而不是把别人的 span 抢来
    const t = await ch.runTurn(async () => {
      r.push(span("orphan"));
      return 1;
    });
    expect(t.spans).toHaveLength(0);
    expect(t.attribution).toBe("traceparent");
  });

  it("sweep:按本 attempt 的 traceId 捞迟到 span,只捞一次", async () => {
    const r = fakeReceiver();
    const ch = new AgentOtelChannel(r);
    const turn = await ch.runTurn(async (headers) => {
      r.push(span(headers.traceparent.split("-")[1]));
      return 0;
    });
    // 迟到批:turn 结束后才被导出
    r.push(span(turn.traceId));
    const late = await ch.sweep(new Set([turn.traceId]));
    expect(late).toHaveLength(1);
    expect(await ch.sweep(new Set([turn.traceId]))).toHaveLength(0);
  });
});
