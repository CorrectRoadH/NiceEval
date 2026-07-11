import { describe, expect, it, vi } from "vitest";
import { withProvisionRetry, type ProvisionSlot } from "./retry.ts";

function fakeSlot() {
  const calls: string[] = [];
  const slot: ProvisionSlot = {
    release: async () => {
      calls.push("release");
    },
    reacquire: async () => {
      calls.push("reacquire");
    },
  };
  return { slot, calls };
}

describe("withProvisionRetry", () => {
  it("succeeds without touching the slot when create() succeeds first try", async () => {
    const { slot, calls } = fakeSlot();
    const result = await withProvisionRetry(
      async () => "sandbox",
      () => "unknown",
      slot,
    );
    expect(result).toBe("sandbox");
    expect(calls).toEqual([]);
  });

  it("throws immediately on a non-retryable error without touching the slot", async () => {
    const { slot, calls } = fakeSlot();
    const err = new Error("bad template");
    await expect(
      withProvisionRetry(
        async () => {
          throw err;
        },
        () => "unknown",
        slot,
      ),
    ).rejects.toBe(err);
    expect(calls).toEqual([]);
  });

  it("releases the slot before backing off and reacquires it before retrying", async () => {
    vi.useFakeTimers();
    try {
      const { slot, calls } = fakeSlot();
      let attempts = 0;
      const promise = withProvisionRetry(
        async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("rate limited");
          return "sandbox";
        },
        () => "rate_limit",
        slot,
      );
      // 第一次失败后应该先 release,再进入退避睡眠 —— 此时还没到 reacquire。
      await vi.waitFor(() => expect(calls).toEqual(["release"]));
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe("sandbox");
      expect(calls).toEqual(["release", "reacquire"]);
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
