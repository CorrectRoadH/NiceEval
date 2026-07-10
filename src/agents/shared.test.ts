import { describe, expect, it } from "vitest";
import { shared } from "./shared.ts";
import { defineSandboxAgent, defineAgent } from "../define.ts";
import type { Sandbox } from "../types.ts";

function fakeSandbox(files: Record<string, string> = {}): Sandbox & { files: Record<string, string>; shellLog: string[] } {
  const shellLog: string[] = [];
  return {
    workdir: "/work",
    sandboxId: "fake",
    otlpHost: null,
    runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    runShell: async (script) => {
      shellLog.push(script);
      // 模拟 `mkdir -p ... && cat > path <<'DELIM' ... DELIM` / `cat >>` 两种 heredoc。
      const m = script.match(/cat (>|>>) (\S+) <<'([^']+)'\n([\s\S]*)\n\3\n$/);
      if (m) {
        const [, mode, path, , body] = m;
        files[path] = mode === ">>" ? (files[path] ?? "") + body : body;
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    readFile: async (path) => {
      if (!(path in files)) throw new Error(`no such file: ${path}`);
      return files[path];
    },
    fileExists: async (path) => path in files,
    readSourceFiles: async () =>
      Object.assign([], { text: () => "", code: () => "", fileMatching: () => undefined, fileMatchingAll: () => undefined, hasPath: () => false }),
    writeFiles: async () => {},
    uploadFiles: async () => {},
    uploadDirectory: async () => {},
    stop: async () => {},
    downloadFile: async () => Buffer.from(""),
    uploadFile: async () => {},
    files,
    shellLog,
  };
}

function fakeCtx() {
  return {
    signal: new AbortController().signal,
    params: {},
    sandbox: undefined as unknown as Sandbox,
    session: { capture: () => {}, history: () => ({ get: () => [], commit: () => {} }), hold: () => {}, take: () => undefined, state: {} },
    log: () => {},
  } as Parameters<NonNullable<ReturnType<typeof defineSandboxAgent>["setup"]>>[1];
}

describe("shared.registerMcp", () => {
  it("appends MCP config after the base agent's own setup, for claude-code", async () => {
    const base = defineSandboxAgent({
      name: "claude-code",
      async setup(sb) {
        await sb.runShell(`mkdir -p $(dirname ~/.claude.json) && cat > ~/.claude.json <<'D'\n{"mcpServers":{"base":{"command":"npx"}}}\nD\n`);
      },
      async send() {
        return { events: [], status: "completed" as const };
      },
    });

    const wrapped = shared.registerMcp(base, [{ name: "extra", command: "uvx", args: ["foo"] }]);
    const sandbox = fakeSandbox();
    await wrapped.setup?.(sandbox, fakeCtx());

    const written = JSON.parse(sandbox.files["~/.claude.json"]);
    expect(written.mcpServers.base).toEqual({ command: "npx" });
    expect(written.mcpServers.extra).toEqual({ command: "uvx", args: ["foo"] });
  });

  it("appends MCP config for codex without disturbing prior config.toml content", async () => {
    const base = defineSandboxAgent({
      name: "codex",
      async setup(sb) {
        await sb.runShell(`mkdir -p $(dirname ~/.codex/config.toml) && cat > ~/.codex/config.toml <<'D'\nmodel_reasoning_effort = "medium"\nD\n`);
      },
      async send() {
        return { events: [], status: "completed" as const };
      },
    });

    const wrapped = shared.registerMcp(base, [{ name: "browser", command: "npx", env: { TOKEN: "x" } }]);
    const sandbox = fakeSandbox();
    await wrapped.setup?.(sandbox, fakeCtx());

    const toml = sandbox.files["~/.codex/config.toml"];
    expect(toml).toContain('model_reasoning_effort = "medium"');
    expect(toml).toContain("[mcp_servers.browser]");
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain("[mcp_servers.browser.env]");
    expect(toml).toContain('TOKEN = "x"');
  });

  it("fails fast for agents without MCP support", () => {
    const bub = defineSandboxAgent({ name: "bub", async send() { return { events: [], status: "completed" as const }; } });
    expect(() => shared.registerMcp(bub, [{ name: "x", command: "npx" }])).toThrow(/不支持 MCP/);
  });

  it("fails fast for remote agents (no sandbox to write into)", () => {
    const remote = defineAgent({ name: "remote-thing", async send() { return { events: [], status: "completed" as const }; } });
    expect(() => shared.registerMcp(remote, [{ name: "x", command: "npx" }])).toThrow(/不是沙箱型 agent/);
  });

  it("is a no-op passthrough when servers is empty", () => {
    const base = defineSandboxAgent({ name: "claude-code", async send() { return { events: [], status: "completed" as const }; } });
    expect(shared.registerMcp(base, [])).toBe(base);
  });
});
