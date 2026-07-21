// cases: docs/engineering/testing/unit/reports.md
// "validate*Data 递归覆盖到嵌套字段" 行:site-components 四个 validate*Data 的表驱动字段突变覆盖,重点是 ScopeWarning 的四个已登记
// kind 各自的必填字段,以及未登记 kind 的前向兼容放行路径(与 ScopeWarnings 组件的「未知 kind
// 单独成组」渲染回退是同一条契约,结构校验不能比渲染逻辑更严)。

import { describe, expect, it } from "vitest";
import { validateCopyFixPromptData, validateHeroData, validateScopeWarningsData, validateTraceWaterfallData } from "./index.tsx";

describe("validateHeroData", () => {
  it("合规 literal 通过,latestStartedAt 为 null 合法(空范围不编造当前时间)", () => {
    expect(validateHeroData({ latestStartedAt: null, snapshots: 0 })).toBeNull();
  });

  it("snapshots 非数字报错", () => {
    expect(validateHeroData({ latestStartedAt: null, snapshots: "0" })).toMatch(/"snapshots"/);
  });
});

describe("validateScopeWarningsData — ScopeWarning 判别联合", () => {
  it("partial-coverage 缺 covered 报错", () => {
    const bad = [{ kind: "partial-coverage", experimentId: "exp/a", total: 6, message: "m", command: "niceeval exp exp/a" }];
    expect(validateScopeWarningsData(bad)).toMatch(/"data\[0\]\.covered"/);
  });

  it("stale-snapshot 缺 latestStartedAt 报错", () => {
    const bad = [{ kind: "stale-snapshot", experimentId: "exp/a", startedAt: "t1", message: "m", command: "c" }];
    expect(validateScopeWarningsData(bad)).toMatch(/"data\[0\]\.latestStartedAt"/);
  });

  it("unfinished-snapshot 缺 dir 报错", () => {
    const bad = [{ kind: "unfinished-snapshot", experimentId: "exp/a", startedAt: "t1", message: "m", command: "c" }];
    expect(validateScopeWarningsData(bad)).toMatch(/"data\[0\]\.dir"/);
  });

  it("unreadable-snapshot 的 reason 不在三态枚举内报错;没有 experimentId 字段本身合法(非实验作用域)", () => {
    const bad = [{ kind: "unreadable-snapshot", dir: "/r/snap", reason: "corrupted", message: "m" }];
    expect(validateScopeWarningsData(bad)).toMatch(/"data\[0\]\.reason"/);
    const ok = [{ kind: "unreadable-snapshot", dir: "/r/snap", reason: "malformed", message: "m" }];
    expect(validateScopeWarningsData(ok)).toBeNull();
  });

  it("unreadable-snapshot 省略 command 合法(不是每个 reason 都有单条命令)", () => {
    const ok = [{ kind: "unreadable-snapshot", dir: "/r/snap", reason: "incomplete", message: "m" }];
    expect(validateScopeWarningsData(ok)).toBeNull();
  });

  it("未登记的 kind 只要有 kind/message 就放行——前向兼容,不拒绝未来版本产出的新 kind", () => {
    const future = [{ kind: "future-kind", message: "something new happened" }];
    expect(validateScopeWarningsData(future)).toBeNull();
  });

  it("未登记的 kind 缺 message 仍报错(两族共用的最小形状)", () => {
    const bad = [{ kind: "future-kind" }];
    expect(validateScopeWarningsData(bad)).toMatch(/"data\[0\]\.message"/);
  });
});

describe("validateCopyFixPromptData", () => {
  it("合规 literal 通过", () => {
    expect(validateCopyFixPromptData({ prompt: "fix it", failures: 1 })).toBeNull();
  });

  it("failures 非数字报错", () => {
    expect(validateCopyFixPromptData({ prompt: "x", failures: "1" })).toMatch(/"failures"/);
  });
});

describe("validateTraceWaterfallData", () => {
  const validSpan = { name: "turn", kind: "agent", startOffsetMs: 0, durationMs: 100, failed: false };
  const valid = [{ experimentId: "exp/a", evalId: "q1", locator: "@1abcdef2", durationMs: 100, spans: [validSpan] }];

  it("合规 literal 通过", () => {
    expect(validateTraceWaterfallData(valid)).toBeNull();
  });

  it("durationMs 为 null 合法(trace 缺失时如实显示缺失)", () => {
    expect(validateTraceWaterfallData([{ ...valid[0], durationMs: null }])).toBeNull();
  });

  it("spans[i].kind 不在四态枚举内报错", () => {
    const bad = [{ ...valid[0], spans: [{ ...validSpan, kind: "runner" }] }];
    expect(validateTraceWaterfallData(bad)).toMatch(/"data\[0\]\.spans\[0\]\.kind"/);
  });

  it("spans[i].failed 非布尔报错", () => {
    const bad = [{ ...valid[0], spans: [{ ...validSpan, failed: "true" }] }];
    expect(validateTraceWaterfallData(bad)).toMatch(/"data\[0\]\.spans\[0\]\.failed"/);
  });
});
