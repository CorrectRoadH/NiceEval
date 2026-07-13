import { describe, expect, it } from "vitest";
import { createCheckpoint, restoreCheckpoint } from "./checkpoint.ts";
import type { Sandbox } from "../types.ts";

function sandbox(overrides: Partial<Sandbox> = {}): Sandbox {
  return {
    workdir: "/work",
    sandboxId: "fake",
    otlpHost: null,
    runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    runShell: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    readFile: async () => "",
    fileExists: async () => false,
    readSourceFiles: async () => Object.assign([], {
      text: () => "", code: () => "", fileMatching: () => undefined,
      fileMatchingAll: () => undefined, hasPath: () => false,
    }),
    writeFiles: async () => {},
    uploadFiles: async () => {},
    uploadDirectory: async () => {},
    stop: async () => {},
    downloadFile: async () => Buffer.from("archive"),
    uploadFile: async () => {},
    ...overrides,
  };
}

describe("sandbox checkpoints", () => {
  it("fails when archive creation fails instead of downloading a bogus checkpoint", async () => {
    let downloaded = false;
    const sb = sandbox({
      runShell: async (script) => script.startsWith("tar ")
        ? { stdout: "", stderr: "permission denied", exitCode: 2 }
        : { stdout: "", stderr: "", exitCode: 0 },
      downloadFile: async () => { downloaded = true; return Buffer.from("bad"); },
    });
    await expect(createCheckpoint(sb, ["/cache"])).rejects.toThrow("checkpoint archive failed");
    expect(downloaded).toBe(false);
  });

  it("fails when restore tar fails even though cleanup succeeds", async () => {
    const calls: string[] = [];
    const sb = sandbox({
      runShell: async (script) => {
        calls.push(script);
        return script.startsWith("tar ")
          ? { stdout: "", stderr: "invalid gzip", exitCode: 2 }
          : { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    await expect(restoreCheckpoint(sb, Buffer.from("bad"))).rejects.toThrow("checkpoint restore failed");
    expect(calls.some((call) => call.startsWith("rm -f "))).toBe(true);
  });
});
