// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖「留存(keep)登记项的 expiresAt」一行里「`niceeval sandbox list` 的过期分支据登记项的
// `expiresAt` 展示保留截止时刻」这一条。只 mock `inspectDetached`(现场核对的落地在 keep.ts,
// 由「detached 生命周期路由」那一行的覆盖单独证明),这里只证明 list 命令拿到 "expired" 之后
// 怎么用登记项的 expiresAt 字段。enter/history/diff 的能力路由与 lease 互斥属于「sandbox
// enter/history/diff 的能力路由」那一行声明的覆盖,不在本文件内。

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeKeptEntry, type KeptSandboxEntry } from "./keep-registry.ts";

const mockInspectDetached = vi.fn<(provider: string, sandboxId: string) => Promise<"alive" | "dormant" | "expired">>();

vi.mock("./keep.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./keep.ts")>();
  return { ...actual, inspectDetached: mockInspectDetached };
});

const { runSandboxCommand } = await import("./cli-commands.ts");

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
  mockInspectDetached.mockReset();
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-sandbox-list-"));
  roots.push(dir);
  return dir;
}

function entry(over: Partial<KeptSandboxEntry> = {}): KeptSandboxEntry {
  return {
    sandboxId: "a3f9c2d1",
    provider: "vercel",
    evalId: "onboarding/tool-first",
    attempt: 1,
    locator: "@1x7f3q9k",
    verdict: "errored",
    keptAt: "2026-07-14T15:02:00.000Z",
    workdir: "/vercel/sandbox",
    state: "alive",
    ...over,
  };
}

function collectOut() {
  const lines: string[] = [];
  return { io: { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) }, lines: () => lines.join("") };
}

describe("niceeval sandbox list — expired 分支", () => {
  it("vercel 条目带 expiresAt:核对现场为 expired 时,展示 expiresAt 换算出的保留截止时刻", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const expiresAt = "2026-08-13T15:02:00.000Z"; // keptAt + 30 天
    await writeKeptEntry(niceevalRoot, entry({ expiresAt }));
    mockInspectDetached.mockResolvedValue("expired");

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["list"], { run: niceevalRoot }, io);

    expect(code).toBe(0);
    const out = lines();
    expect(out).toContain("expired");
    expect(out).toContain("remove with: niceeval sandbox stop");
    // formatWhen 不导出,直接核对年月日片段而不依赖具体时区的时分表示。
    expect(out).toMatch(/expired 2026-08-13/);
  });

  it("e2b 条目没有 expiresAt(官方契约无自然过期,niceeval 不写):现场核对仍能报 expired,且不显示虚构的过期时刻", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(niceevalRoot, entry({ provider: "e2b", sandboxId: "e2b-sbx-1" }));
    mockInspectDetached.mockResolvedValue("expired");

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["list"], { run: niceevalRoot }, io);

    expect(code).toBe(0);
    const out = lines();
    expect(out).toContain("expired");
    expect(out).toContain("remove with: niceeval sandbox stop");
    // 没有 expiresAt 时不拼出 "expired undefined" 一类假时刻。
    expect(out).not.toContain("expired undefined");
    expect(out).not.toMatch(/expired \d{4}-\d{2}-\d{2}/);
  });

  it("docker 条目没有 expiresAt(本地停驻,非远端保留期概念):同样只在真实核对为 expired 时才报,不据字段猜测", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    await writeKeptEntry(niceevalRoot, entry({ provider: "docker", sandboxId: "docker-sbx-1", workdir: "/workspace" }));
    mockInspectDetached.mockResolvedValue("dormant");

    const { io, lines } = collectOut();
    const code = await runSandboxCommand(root, ["list"], { run: niceevalRoot }, io);

    expect(code).toBe(0);
    const out = lines();
    expect(out).not.toContain("expired");
    expect(out).toContain("enter: niceeval sandbox enter");
  });
});
