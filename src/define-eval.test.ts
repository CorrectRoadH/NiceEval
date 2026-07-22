// cases: docs/engineering/testing/unit/eval.md
// defineEval / defineScoreEval 的题型标记(契约见 docs/feature/eval/README.md「defineScoreEval:
// 计分制题型」、docs/feature/experiments/score-points.md):两者字段与校验规则完全同形,唯一
// 运行时差异是各自定死的 scoring 值;.points()/t.score 只在计分制 t 上存在,是类型层的证明
// (typecheck fixture),不需要运行时守护。

import { describe, expect, it } from "vitest";
import { defineEval, defineScoreEval } from "./define.ts";
import { makeAssertion } from "./expect/index.ts";
import type { ScoreTestContext, TestContext } from "./types.ts";

describe("defineEval:通过制", () => {
  it("产物恒 scoring: \"pass\"", () => {
    const def = defineEval({ async test() {} });
    expect(def.scoring).toBe("pass");
  });

  it("拒绝显式 id(id 由文件路径推导)", () => {
    expect(() => defineEval({ id: "manual-id", async test() {} } as never)).toThrow(/id/);
  });

  it("拒绝显式 scoring(题型由 defineEval/defineScoreEval 定死,不可手写)", () => {
    expect(() => defineEval({ scoring: "points", async test() {} } as never)).toThrow(/scoring/);
  });

  it("要求 test 是函数", () => {
    expect(() => defineEval({} as never)).toThrow(/test/);
  });

  it("environment 为空字符串时报错", () => {
    expect(() => defineEval({ environment: "  ", async test() {} })).toThrow(/environment/);
  });
});

describe("defineScoreEval:计分制", () => {
  it("产物恒 scoring: \"points\"", () => {
    const def = defineScoreEval({ async test() {} });
    expect(def.scoring).toBe("points");
  });

  it("拒绝显式 id(与 defineEval 同规则,报错指名 defineScoreEval)", () => {
    expect(() => defineScoreEval({ id: "manual-id", async test() {} } as never)).toThrow(/defineScoreEval/);
  });

  it("拒绝显式 scoring,报错指名 defineScoreEval(不复用 defineEval 的文案)", () => {
    expect(() => defineScoreEval({ scoring: "pass", async test() {} } as never)).toThrow(/defineScoreEval/);
  });

  it("要求 test 是函数,报错指名 defineScoreEval", () => {
    expect(() => defineScoreEval({} as never)).toThrow(/defineScoreEval/);
  });

  it("environment 为空字符串时报错,指名 defineScoreEval", () => {
    expect(() => defineScoreEval({ environment: "  ", async test() {} })).toThrow(/defineScoreEval/);
  });

  it("字段与 defineEval 完全同形:description/tags/environment/metadata 原样保留", () => {
    const def = defineScoreEval({
      description: "rubric task",
      tags: ["coding"],
      environment: "node-22",
      metadata: { owner: "team-a" },
      async test() {},
    });
    expect(def.description).toBe("rubric task");
    expect(def.tags).toEqual(["coding"]);
    expect(def.environment).toBe("node-22");
    expect(def.metadata).toEqual({ owner: "team-a" });
  });
});

describe("类型层:给分词汇只存在于计分制的 t 上", () => {
  it("defineScoreEval 的 t 上 .points() / t.score() 类型检查通过(typecheck fixture)", () => {
    defineScoreEval({
      async test(t: ScoreTestContext) {
        t.check(1, makeAssertion({ name: "x", score: () => 1 })).points(1);
        t.score("直接给分", 10);
      },
    });
    expect(true).toBe(true);
  });

  it("defineEval 的 t 上写 .points() / t.score() 是类型错误(与计分制 t 的关键差异)", () => {
    defineEval({
      async test(t: TestContext) {
        const handle = t.check(1, makeAssertion({ name: "x", score: () => 1 }));
        // @ts-expect-error 通过制 t 的 AssertionHandle 没有 .points(),给分词汇只在计分制 t 上存在
        handle.points(1);
        // @ts-expect-error 通过制 t 上没有 t.score,直接给分只在计分制 t 上存在
        t.score("直接给分", 10);
      },
    });
    expect(true).toBe(true);
  });
});
