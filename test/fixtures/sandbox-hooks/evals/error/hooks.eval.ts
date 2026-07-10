import { defineEval } from "niceeval";

export default defineEval({
  description: "sandbox.setup 抛错回归(不应该跑到这里)",
  async test(t) {
    const turn = await t.send("hi");
    turn.expectOk();
    t.succeeded();
  },
});
