import { defineEval } from "niceeval";

// Deterministically thrown error — exists solely so this repo can assert the `errored`
// verdict and the JUnit `<error>` folding, kept distinct from the `failed` case in
// deliberate-fail.eval.ts (docs/engineering/testing/e2e/report.md point 4). Throwing inside
// test() is an eval-script exception — a framework/environment-level fault, not an
// assertion outcome — so the runner records it as `errored`, never `failed`.
export default defineEval({
  description: "deliberate-error:确定性执行错误(未捕获异常),验证 errored 判定与 JUnit <error> 折叠",

  async test() {
    throw new Error("deliberate error for e2e contract testing");
  },
});
