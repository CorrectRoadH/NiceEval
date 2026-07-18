// cases: docs/engineering/unit-tests/experiments-runner/cases.md
import { describe, expect, it } from "vitest";
import { matchExperimentSelector } from "./aggregate.ts";

describe("matchExperimentSelector", () => {
  const ids = [
    "compare/bub-gpt-5.6-luna",
    "compare/codex-gpt-5.6-luna",
    "compare/codex-gpt-5.6-luna--agents-md",
    "compare/codex-gpt-5.6-luna--mempal",
    "dev-e2b/bub-e2b",
    "dev/bub-gpt-5.4-mini",
    "top-level",
  ];

  it("selects an entire group by exact directory match", () => {
    expect(matchExperimentSelector(ids, "compare")).toEqual([
      "compare/bub-gpt-5.6-luna",
      "compare/codex-gpt-5.6-luna",
      "compare/codex-gpt-5.6-luna--agents-md",
      "compare/codex-gpt-5.6-luna--mempal",
    ]);
  });

  it("an exact id match wins even when it is a prefix of sibling variants", () => {
    expect(matchExperimentSelector(ids, "compare/codex-gpt-5.6-luna")).toEqual([
      "compare/codex-gpt-5.6-luna",
    ]);
  });

  it("falls back to a filename prefix within an exact-matched directory to select a family", () => {
    expect(matchExperimentSelector(ids, "compare/codex")).toEqual([
      "compare/codex-gpt-5.6-luna",
      "compare/codex-gpt-5.6-luna--agents-md",
      "compare/codex-gpt-5.6-luna--mempal",
    ]);
  });

  it("requires an exact directory segment; a group-like prefix does not leak across groups", () => {
    expect(matchExperimentSelector(ids, "dev")).toEqual(["dev/bub-gpt-5.4-mini"]);
    expect(matchExperimentSelector(ids, "dev")).not.toContain("dev-e2b/bub-e2b");
  });

  it("matches a top-level (groupless) experiment by exact id", () => {
    expect(matchExperimentSelector(ids, "top-level")).toEqual(["top-level"]);
  });

  it("returns empty when nothing matches", () => {
    expect(matchExperimentSelector(ids, "dev-e3b")).toEqual([]);
    expect(matchExperimentSelector(ids, "compare/nope")).toEqual([]);
  });
});
