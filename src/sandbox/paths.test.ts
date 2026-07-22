// cases: docs/engineering/testing/unit/sandbox.md
import { describe, expect, it } from "vitest";
import { normalizeSandboxPaths, resolveLocalPath, resolveSandboxPath } from "./paths.ts";
import type { Sandbox } from "../types.ts";

function fakeSandbox(): Sandbox & { calls: string[] } {
  const calls: string[] = [];
  return {
    workdir: "/work",
    sandboxId: "fake",
    otlpHost: null,
    runCommand: async (_cmd, _args, opts) => {
      calls.push(`cwd:${opts?.cwd ?? ""}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    runShell: async (_script, opts) => {
      calls.push(`shell-cwd:${opts?.cwd ?? ""}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    readFile: async (path) => {
      calls.push(`read:${path}`);
      return "";
    },
    fileExists: async (path) => {
      calls.push(`exists:${path}`);
      return true;
    },
    writeFiles: async (_files, targetDir) => {
      calls.push(`write:${targetDir}`);
    },
    uploadFiles: async (_files, targetDir) => {
      calls.push(`upload:${targetDir}`);
    },
    uploadDirectory: async (_localDir, targetDir) => {
      calls.push(`upload-dir:${targetDir}`);
    },
    stop: async () => {},
    downloadFile: async (path) => {
      calls.push(`download:${path}`);
      return Buffer.from("");
    },
    uploadFile: async (path) => {
      calls.push(`upload-file:${path}`);
    },
    downloadDirectory: async (_localDir, targetDir) => {
      calls.push(`download-dir:${targetDir}`);
    },
    calls,
  };
}

describe("sandbox path helpers", () => {
  it("resolves sandbox paths relative to workdir", () => {
    expect(resolveSandboxPath("/work", undefined)).toBe("/work");
    expect(resolveSandboxPath("/work", "src/app.ts")).toBe("/work/src/app.ts");
    expect(resolveSandboxPath("/work", "/tmp/out")).toBe("/tmp/out");
  });

  it("resolves local paths relative to eval directories", () => {
    expect(resolveLocalPath("/repo/evals/auth", "../fixtures/app")).toBe("/repo/evals/fixtures/app");
    expect(resolveLocalPath("/repo/evals/auth", "/tmp/app")).toBe("/tmp/app");
  });

  it("normalizes paths for custom sandbox implementations", async () => {
    const sandbox = fakeSandbox();
    const normalized = normalizeSandboxPaths(sandbox);

    await normalized.runCommand("npm", ["test"], { cwd: "packages/api" });
    await normalized.readFile("src/app.ts");
    await normalized.uploadFiles([], "fixtures");
    await normalized.uploadDirectory("/host/app");
    await normalized.downloadFile("dist/out.txt");
    await normalized.downloadDirectory("/host/out", "dist");

    expect(sandbox.calls).toEqual([
      "cwd:/work/packages/api",
      "read:/work/src/app.ts",
      "upload:/work/fixtures",
      "upload-dir:/work",
      "download:/work/dist/out.txt",
      "download-dir:/work/dist",
    ]);
  });

  it("forwards the non-interface suspend() capability when the underlying provider implements it", async () => {
    const sandbox = fakeSandbox() as Sandbox & { calls: string[]; suspend?: () => Promise<void> };
    sandbox.suspend = async () => {
      sandbox.calls.push("suspend");
    };
    const normalized = normalizeSandboxPaths(sandbox);

    // 留存路径的 suspendSandbox()(keep.ts)靠属性探测这个非接口成员——包装后必须还在,
    // 且调用要转发到底层实例(不能只是"存在但不生效"的空转发)。
    expect(typeof (normalized as unknown as { suspend?: unknown }).suspend).toBe("function");
    await (normalized as unknown as { suspend(): Promise<void> }).suspend();
    expect(sandbox.calls).toEqual(["suspend"]);
  });

  it("omits suspend entirely when the underlying provider does not implement it (no fake capability appears)", () => {
    const sandbox = fakeSandbox(); // no .suspend on this fixture
    const normalized = normalizeSandboxPaths(sandbox);
    expect((normalized as unknown as { suspend?: unknown }).suspend).toBeUndefined();
  });
});
