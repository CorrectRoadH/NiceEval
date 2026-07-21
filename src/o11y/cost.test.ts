// cases: docs/engineering/testing/unit/reports.md
import { describe, expect, it } from "vitest";

import { estimateCost } from "./cost.ts";

describe("estimateCost pricing overrides", () => {
  it("精确 model key 覆盖内置价格表", () => {
    const usd = estimateCost(
      "anthropic/claude-opus-4-8",
      { inputTokens: 1_000_000, outputTokens: 0 },
      { "anthropic/claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 } },
    );
    expect(usd).toBe(5);
  });

  it("provider/* 通配覆盖同 provider 下所有 model", () => {
    const usd = estimateCost(
      "my-selfhosted/llama-70b",
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { "my-selfhosted/*": { inputPerMTok: 0, outputPerMTok: 0 } },
    );
    expect(usd).toBeUndefined(); // 自托管免费:usd 恒 0,estimateCost 只在 > 0 时返回数值
  });

  it("没有覆盖时落回内置快照(查不到就是 undefined,不瞎猜)", () => {
    const usd = estimateCost("totally-unknown-model-xyz", { inputTokens: 1000, outputTokens: 1000 });
    expect(usd).toBeUndefined();
  });

  it("精确 key 优先于通配", () => {
    const usd = estimateCost(
      "my-selfhosted/llama-70b",
      { inputTokens: 1_000_000, outputTokens: 0 },
      {
        "my-selfhosted/*": { inputPerMTok: 0, outputPerMTok: 0 },
        "my-selfhosted/llama-70b": { inputPerMTok: 2, outputPerMTok: 2 },
      },
    );
    expect(usd).toBe(2);
  });
});
