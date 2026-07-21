// cases: docs/engineering/testing/unit/sandbox/cases.md
import { describe, expect, it, vi } from "vitest";
import { classifySandboxIoError } from "./errors.ts";
import { withSandboxIoRetry } from "./io-retry.ts";

describe("classifySandboxIoError", () => {
  it("recognizes the nested fetch failure shape emitted by E2B uploads", () => {
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) });
    expect(classifySandboxIoError(error)).toBe("network");
  });

  it("recognizes status-bearing rate limits and service outages", () => {
    expect(classifySandboxIoError({ response: { status: 429 } })).toBe("rate_limit");
    expect(classifySandboxIoError({ statusCode: 503 })).toBe("service_unavailable");
  });

  it("does not retry cancellation, sandbox termination, or deterministic file errors", () => {
    expect(classifySandboxIoError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("unknown");
    expect(classifySandboxIoError(new Error("Sandbox was terminated"))).toBe("unknown");
    expect(classifySandboxIoError(new Error("ENOENT: no such file"))).toBe("unknown");
  });
});

describe("withSandboxIoRetry", () => {
  it("retries a transient failure with bounded exponential backoff", async () => {
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    let attempts = 0;
    const result = await withSandboxIoRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError("fetch failed");
      return "ok";
    }, { baseDelayMs: 100, random: () => 0.5, sleep, onRetry });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
    expect(onRetry.mock.calls.map(([event]) => event.kind)).toEqual(["network", "network"]);
  });

  it("preserves the original error after the retry limit", async () => {
    const error = new TypeError("fetch failed");
    await expect(withSandboxIoRetry(
      async () => { throw error; },
      { maxAttempts: 2, baseDelayMs: 0, sleep: async () => {} },
    )).rejects.toBe(error);
  });

  it("does not retry deterministic errors", async () => {
    let attempts = 0;
    const error = new Error("ENOENT: missing");
    await expect(withSandboxIoRetry(async () => {
      attempts += 1;
      throw error;
    })).rejects.toBe(error);
    expect(attempts).toBe(1);
  });
});
