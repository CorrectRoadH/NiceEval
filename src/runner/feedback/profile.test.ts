// cases: docs/engineering/unit-tests/experiments-runner/cases.md
import { describe, expect, it } from "vitest";
import { isCIEnvironment, resolveOutputProfile } from "./profile.ts";

describe("resolveOutputProfile", () => {
  it("显式值永远覆盖自动检测,无论 isTTY/env 是什么", () => {
    expect(resolveOutputProfile({ explicit: "agent", isTTY: true, env: { CI: "true" } })).toBe("agent");
    expect(resolveOutputProfile({ explicit: "ci", isTTY: true, env: {} })).toBe("ci");
    expect(resolveOutputProfile({ explicit: "human", isTTY: false, env: { CI: "true" } })).toBe("human");
  });

  it("auto:stderr 是 TTY → human,即便同时设了 CI 环境标记(TTY 优先于 CI 探测)", () => {
    expect(resolveOutputProfile({ explicit: "auto", isTTY: true, env: { CI: "true" } })).toBe("human");
  });

  it("auto:非 TTY + CI 环境标记 → ci", () => {
    expect(resolveOutputProfile({ explicit: "auto", isTTY: false, env: { CI: "true" } })).toBe("ci");
  });

  it("auto:非 TTY + 无 CI 环境标记 → agent", () => {
    expect(resolveOutputProfile({ explicit: "auto", isTTY: false, env: {} })).toBe("agent");
  });
});

describe("isCIEnvironment", () => {
  it("命中任意已知 CI 平台变量即为 true", () => {
    expect(isCIEnvironment({ CI: "true" })).toBe(true);
    expect(isCIEnvironment({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(isCIEnvironment({ GITLAB_CI: "true" })).toBe(true);
    expect(isCIEnvironment({ CIRCLECI: "true" })).toBe(true);
    expect(isCIEnvironment({ TRAVIS: "true" })).toBe(true);
    expect(isCIEnvironment({ BUILDKITE: "true" })).toBe(true);
    expect(isCIEnvironment({ JENKINS_URL: "https://ci.example.com" })).toBe(true);
    expect(isCIEnvironment({ TEAMCITY_VERSION: "2024.1" })).toBe(true);
    expect(isCIEnvironment({ APPVEYOR: "true" })).toBe(true);
    expect(isCIEnvironment({ TF_BUILD: "true" })).toBe(true);
  });

  it("空对象、无关变量都不算 CI", () => {
    expect(isCIEnvironment({})).toBe(false);
    expect(isCIEnvironment({ PATH: "/usr/bin", HOME: "/root" })).toBe(false);
  });

  it("显式关闭(空串 / \"false\" / \"0\")不算已设置,不该被误判成在 CI 里", () => {
    expect(isCIEnvironment({ CI: "" })).toBe(false);
    expect(isCIEnvironment({ CI: "false" })).toBe(false);
    expect(isCIEnvironment({ CI: "0" })).toBe(false);
    expect(isCIEnvironment({ CI: undefined })).toBe(false);
  });
});
