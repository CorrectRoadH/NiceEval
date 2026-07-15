// cases: docs/engineering/unit-tests/adapters/cases.md
// parseOtlpTraces 两种线编码的回归测试。protobuf 路径此前零覆盖——bub(Python OTLP
// 出口只有 protobuf)的 trace 全靠它,解析静默失败的表现就是"span 收到了但 trace 是空的"。
// 这里不引 opentelemetry 依赖,用一个最小 protobuf writer 按 opentelemetry-proto 字段号手工编码。

import { describe, expect, it } from "vitest";
import { parseOtlpTraces } from "./parse.ts";

// ── 最小 protobuf writer(varint / length-delimited / fixed64)──

function varint(n: number | bigint): Buffer {
  let v = BigInt(n);
  const out: number[] = [];
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if (v === 0n) {
      out.push(b);
      break;
    }
    out.push(b | 0x80);
  }
  return Buffer.from(out);
}

function lenDelim(field: number, payload: Buffer): Buffer {
  return Buffer.concat([varint((field << 3) | 2), varint(payload.length), payload]);
}

function fixed64(field: number, n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return Buffer.concat([varint((field << 3) | 1), b]);
}

function varintField(field: number, n: number): Buffer {
  return Buffer.concat([varint(field << 3), varint(n)]);
}

function stringAttr(key: string, value: string): Buffer {
  // KeyValue { 1:key 2:AnyValue{ 1:string_value } }
  return Buffer.concat([
    lenDelim(1, Buffer.from(key)),
    lenDelim(2, lenDelim(1, Buffer.from(value))),
  ]);
}

describe("parseOtlpTraces / protobuf", () => {
  it("按 opentelemetry-proto 字段号解出 span 的瀑布图字段", () => {
    const traceId = Buffer.from("0102030405060708090a0b0c0d0e0f10", "hex");
    const spanId = Buffer.from("1112131415161718", "hex");
    const parentId = Buffer.from("2122232425262728", "hex");
    // Span { 1:trace_id 2:span_id 4:parent 5:name 7:start 8:end 9:attrs 15:Status{3:code} }
    const span = Buffer.concat([
      lenDelim(1, traceId),
      lenDelim(2, spanId),
      lenDelim(4, parentId),
      lenDelim(5, Buffer.from("bub.agent.step")),
      fixed64(7, 1_700_000_000_000_000_000n),
      fixed64(8, 1_700_000_001_500_000_000n),
      lenDelim(9, stringAttr("gen_ai.operation.name", "chat")),
      lenDelim(15, varintField(3, 2)), // STATUS_CODE_ERROR
    ]);
    // ExportTraceServiceRequest { 1:ResourceSpans { 2:ScopeSpans { 2:Span } } }
    const body = lenDelim(1, lenDelim(2, lenDelim(2, span)));

    const spans = parseOtlpTraces(body, "application/x-protobuf");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({
      traceId: "0102030405060708090a0b0c0d0e0f10",
      spanId: "1112131415161718",
      parentSpanId: "2122232425262728",
      name: "bub.agent.step",
      startMs: 1_700_000_000_000,
      endMs: 1_700_000_001_500,
      status: "error",
      attributes: { "gen_ai.operation.name": "chat" },
    });
  });

  it("未知字段跳过不影响解析,坏 payload 回空数组而不是抛错", () => {
    // 在 span 前后夹私有字段(field 200, varint)——解析应无视它们。
    const span = Buffer.concat([
      varintField(200, 7),
      lenDelim(5, Buffer.from("only-name")),
      varintField(201, 9),
    ]);
    const body = lenDelim(1, lenDelim(2, lenDelim(2, span)));
    const spans = parseOtlpTraces(body, "application/x-protobuf");
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("only-name");

    expect(parseOtlpTraces(Buffer.from("not protobuf at all"), "application/x-protobuf")).toEqual([]);
  });
});

describe("parseOtlpTraces / json", () => {
  it("codex 风格 OTLP/JSON:hex id + 十进制纳秒字符串", () => {
    const body = Buffer.from(
      JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: "0102030405060708090a0b0c0d0e0f10",
                    spanId: "1112131415161718",
                    name: "codex.turn",
                    startTimeUnixNano: "1700000000000000000",
                    endTimeUnixNano: "1700000001500000000",
                    status: { code: 1 },
                    attributes: [{ key: "k", value: { stringValue: "v" } }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const spans = parseOtlpTraces(body, "application/json");
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("codex.turn");
    expect(spans[0].startMs).toBe(1_700_000_000_000);
    expect(spans[0].attributes).toEqual({ k: "v" });
  });
});
