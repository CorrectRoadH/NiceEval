// cases: docs/engineering/testing/unit/eval.md
// defineEval / defineScoreEval 的题型标记(契约见 docs/feature/eval/README.md「defineScoreEval:
// 计分制题型」、docs/feature/experiments/score-points.md):两者字段与校验规则完全同形,唯一
// 运行时差异是各自定死的 scoring 值;.points()/t.score 只在计分制 t 上存在,是类型层的证明
// (typecheck fixture),不需要运行时守护。

import { describe, expect, it } from "vitest";
import { defineEval, defineScoreEval } from "./define.ts";
import { makeAssertion } from "./expect/index.ts";
import type { BaseAssertionHandle, BaseTestContext, ScoreTestContext, TestContext } from "./types.ts";

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

  it("计分制句柄上一条断言只扮演一个角色:.points() 之后只剩 .gate()/.optional()", () => {
    defineScoreEval({
      async test(t: ScoreTestContext) {
        const handle = t.check(1, makeAssertion({ name: "x", score: () => 1 }));
        handle.points(1).gate(); // 得分点兼前置:唯一的合法组合
        handle.points(1).optional();
        handle.gate(0.5); // 纯前置(给了通过线)
        handle.soft(); // 观测(纯记录)
        handle.atLeast(0.7); // 观测(带通过线:低于线记 failed,不影响判定)
        // @ts-expect-error 得分点已经用分数表达了分量,再进质量分就是同一条证据被读两遍
        handle.points(1).soft();
        // @ts-expect-error 同上:得分点的成败由挣分表达,不另设线
        handle.points(1).atLeast(0.7);
      },
    });
    expect(true).toBe(true);
  });

  it("跨题型复用的 helper 标注 BaseTestContext<H>,两种 t 都能传进去", () => {
    // 共享步骤函数(evals/*/share/ 里的典型写法):只用两种题型共有的能力。
    async function step<H extends BaseAssertionHandle>(t: BaseTestContext<H>): Promise<H> {
      await t.send("hi");
      return t.check(t.reply, makeAssertion({ name: "x", score: () => 1 }));
    }
    defineEval({
      async test(t: TestContext) {
        await step(t);
      },
    });
    defineScoreEval({
      async test(t: ScoreTestContext) {
        (await step(t)).points(1); // 句柄类型跟着 H 走:计分制里拿回的是 ScoreAssertionHandle
      },
    });
    expect(true).toBe(true);
  });

  it("计分制的 t 上没有 require:前置只有 t.check(...).gate() 一种写法", () => {
    defineScoreEval({
      async test(t: ScoreTestContext) {
        // @ts-expect-error require 是通过制的前置词,计分制的前置写成 .gate()
        await t.require(1, makeAssertion({ name: "x", score: () => 1 }));
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
