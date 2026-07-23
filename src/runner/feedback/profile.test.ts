// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「形态解析与 --json 流不变量」
import { describe, expect, it } from "vitest";
import { resolveOutputForm } from "./profile.ts";

describe("resolveOutputForm", () => {
  it("json: true → \"json\",无论 isTTY 是什么", () => {
    expect(resolveOutputForm({ json: true, isTTY: true })).toBe("json");
    expect(resolveOutputForm({ json: true, isTTY: false })).toBe("json");
  });

  it("json: false → \"human\",无论 isTTY 是什么", () => {
    expect(resolveOutputForm({ json: false, isTTY: true })).toBe("human");
    expect(resolveOutputForm({ json: false, isTTY: false })).toBe("human");
  });

  it("不读任何 CI 环境变量:函数签名里没有 env 形参,结构上不可能被 process.env.CI 等标记影响", () => {
    const original = process.env.CI;
    process.env.CI = "true";
    try {
      expect(resolveOutputForm({ json: false, isTTY: false })).toBe("human");
      expect(resolveOutputForm({ json: true, isTTY: false })).toBe("json");
    } finally {
      if (original === undefined) delete process.env.CI;
      else process.env.CI = original;
    }
  });
});
