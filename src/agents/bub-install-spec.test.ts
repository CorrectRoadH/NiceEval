import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  BUB_INSTALL_MARKER,
  DEFAULT_BUB_OTEL_PLUGIN,
  DEFAULT_BUB_OVERRIDE,
  bubInstallHash,
  bubInstallSpec,
} from "./bub-install-spec.ts";

describe("Bub install specification", () => {
  it("uses immutable default Git commits", () => {
    expect(DEFAULT_BUB_OVERRIDE).toMatch(/@[0-9a-f]{40}$/);
    expect(DEFAULT_BUB_OTEL_PLUGIN).toMatch(/@[0-9a-f]{40}#subdirectory=/);
  });

  it("fingerprints plugins independent of caller ordering", () => {
    const packages = ["alpha==1", "beta==2"];
    expect(bubInstallHash(packages)).toBe(bubInstallHash([" beta==2 ", "alpha==1", "alpha==1"]));
    expect(bubInstallSpec(packages)).toContain("--with alpha==1 --with beta==2");
    expect(BUB_INSTALL_MARKER).toBe(".local/share/niceeval/bub-install-hash");
  });

  it("keeps the non-TypeScript Docker recipe in sync", async () => {
    const [dockerfile, override] = await Promise.all([
      readFile(new URL("../../sandbox/docker/Dockerfile", import.meta.url), "utf8"),
      readFile(new URL("../../sandbox/docker/bub-override.txt", import.meta.url), "utf8"),
    ]);
    expect(override.trim()).toBe(DEFAULT_BUB_OVERRIDE);
    expect(dockerfile).toContain(DEFAULT_BUB_OTEL_PLUGIN);
    expect(dockerfile).toContain(bubInstallHash([]));
  });
});
