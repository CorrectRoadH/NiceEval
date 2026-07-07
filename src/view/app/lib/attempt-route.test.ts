// #/attempt/<run>/<result> 深链的纯函数单测:解析 / 格式化往返、坏输入、按 attemptRef 定位。

import { describe, expect, it } from "vitest";
import { formatAttemptHash, parseAttemptHash, resolveAttemptRef } from "./attempt-route.ts";
import type { ViewResult, ViewRow } from "../types.ts";

const attempt = (run: string, index: number): ViewResult => ({
  id: `demo/eval-${index}`,
  agent: "demo-agent",
  outcome: "passed",
  attempt: 0,
  durationMs: 1,
  assertions: [],
  attemptRef: { run, result: index },
});

// 榜单行只有 results 参与定位,其余聚合字段与路由无关。
const row = (results: ViewResult[]): ViewRow => ({ results }) as ViewRow;

describe("parseAttemptHash", () => {
  it("parses the canonical run-dir + index shape", () => {
    expect(parseAttemptHash("#/attempt/2026-07-02T03-10-24-123Z/4")).toEqual({
      run: "2026-07-02T03-10-24-123Z",
      result: 4,
    });
  });

  it("round-trips through formatAttemptHash, including runs that need encoding", () => {
    for (const ref of [
      { run: "2026-07-02T03-10-24-123Z", result: 0 },
      { run: "nested/2026-01-01T00-00-00-000Z", result: 12 },
      { run: "with space", result: 3 },
      { run: ".", result: 7 }, // 单文件入口的 run 占位
    ]) {
      expect(parseAttemptHash(formatAttemptHash(ref))).toEqual(ref);
    }
  });

  it("treats the last segment as the index so hand-written nested runs still parse", () => {
    expect(parseAttemptHash("#/attempt/nested/2026-01-01T00-00-00-000Z/12")).toEqual({
      run: "nested/2026-01-01T00-00-00-000Z",
      result: 12,
    });
  });

  it("rejects non-attempt hashes and malformed shapes", () => {
    for (const hash of [
      "",
      "#",
      "#/",
      "#tab-experiments", // 页内锚点不归这条路由
      "#/compare/a/b",
      "#/attempt",
      "#/attempt/",
      "#/attempt/run-only",
      "#/attempt//3",
      "#/attempt/run/",
      "#/attempt/run/abc",
      "#/attempt/run/1.5",
      "#/attempt/run/-1",
      "#/attempt/run/1/", // 末段为空
      "#/attempt/%zz/1", // 非法 % 转义
    ]) {
      expect(parseAttemptHash(hash), hash).toBeNull();
    }
  });
});

describe("resolveAttemptRef", () => {
  const runA = "2026-07-01T10-00-00-000Z";
  const runB = "2026-07-02T10-00-00-000Z";
  const rows = [row([attempt(runA, 0), attempt(runB, 0)]), row([attempt(runA, 1)])];

  it("finds the attempt whose injected ref matches run + index", () => {
    expect(resolveAttemptRef(rows, { run: runA, result: 1 })).toBe(rows[1]!.results[0]);
    expect(resolveAttemptRef(rows, { run: runB, result: 0 })).toBe(rows[0]!.results[1]);
  });

  it("returns null for unknown runs and out-of-range indexes", () => {
    expect(resolveAttemptRef(rows, { run: "no-such-run", result: 0 })).toBeNull();
    expect(resolveAttemptRef(rows, { run: runA, result: 99 })).toBeNull();
  });

  it("returns null when results predate attemptRef injection (old baked data)", () => {
    const legacy = attempt(runA, 0);
    delete (legacy as { attemptRef?: unknown }).attemptRef;
    expect(resolveAttemptRef([row([legacy])], { run: runA, result: 0 })).toBeNull();
  });
});
