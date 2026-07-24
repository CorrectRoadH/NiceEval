// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖 provisioning「对外的空间轴映射」(见 docs/feature/sandbox/architecture.md
// #provisioning-失败与重试):三档确定性配置死因的识别、按 environments 表定档的
// scope 映射、结构化附着供 failureClassOf 沿 cause 链识别。
import { describe, expect, it } from "vitest";
import { attachProvisionFailureScope, classifyProvisionConfigCause, provisionConfigCauseScope } from "./errors.ts";

describe("classifyProvisionConfigCause", () => {
  it("recognizes e2b's AuthenticationError shape (name-based, no status code) as credentials", () => {
    const error = Object.assign(new Error("Unauthorized, please check your credentials."), { name: "AuthenticationError" });
    expect(classifyProvisionConfigCause(error)).toBe("credentials");
  });

  it("recognizes a generic 401 response as credentials", () => {
    expect(classifyProvisionConfigCause({ status: 401, message: "unauthorized" })).toBe("credentials");
  });

  it("recognizes a 403 response and docker-style pull-access-denied text as permission", () => {
    expect(classifyProvisionConfigCause({ status: 403 })).toBe("permission");
    expect(classifyProvisionConfigCause(new Error("pull access denied for acme/private-image"))).toBe("permission");
  });

  it("recognizes a 404 response, e2b NotFoundError text, and docker's missing-image text as template_not_found", () => {
    expect(classifyProvisionConfigCause({ status: 404, message: "template not found" })).toBe("template_not_found");
    expect(classifyProvisionConfigCause(new Error("no such image: acme/does-not-exist:latest"))).toBe("template_not_found");
  });

  it("recognizes vercel's snapshot_not_found error code nested under err.json.error.code", () => {
    const error = { response: { status: 410 }, json: { error: { code: "snapshot_not_found" } } };
    expect(classifyProvisionConfigCause(error)).toBe("template_not_found");
  });

  it("walks the cause chain to find a nested classifiable error", () => {
    const inner = Object.assign(new Error("forbidden"), {});
    const outer = new Error("sandbox create failed", { cause: inner });
    expect(classifyProvisionConfigCause(outer)).toBe("permission");
  });

  it("returns undefined for deterministic errors that don't match any of the three causes", () => {
    expect(classifyProvisionConfigCause(new Error("invalid argument: timeout must be positive"))).toBeUndefined();
  });
});

describe("provisionConfigCauseScope", () => {
  it("maps credentials and permission to experiment scope regardless of the environments table", () => {
    expect(provisionConfigCauseScope("credentials", false)).toBe("experiment");
    expect(provisionConfigCauseScope("credentials", true)).toBe("experiment");
    expect(provisionConfigCauseScope("permission", false)).toBe("experiment");
    expect(provisionConfigCauseScope("permission", true)).toBe("experiment");
  });

  it("maps template_not_found to eval scope when the spec carries an environments table", () => {
    expect(provisionConfigCauseScope("template_not_found", true)).toBe("eval");
  });

  it("maps template_not_found to experiment scope when the spec has no environments table", () => {
    expect(provisionConfigCauseScope("template_not_found", false)).toBe("experiment");
  });
});

describe("attachProvisionFailureScope", () => {
  it("decorates the error with the failureClassOf structural contract (_tag + class)", () => {
    const error = new Error("template not found");
    attachProvisionFailureScope(error, "eval");
    expect((error as unknown as { _tag: string })._tag).toBe("NiceevalClassifiedError");
    expect((error as unknown as { class: unknown }).class).toEqual({ retryable: false, scope: "eval" });
  });

  it("is a no-op for non-object thrown values", () => {
    expect(() => attachProvisionFailureScope("plain string throw", "experiment")).not.toThrow();
  });
});
