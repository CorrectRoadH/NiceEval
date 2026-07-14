import { defineEval } from "niceeval";

export default defineEval({
  description: "CLI profile 回归夹具:恒定通过",
  async test(t) {
    const turn = await t.send("hi");
    turn.expectOk();
    t.succeeded();
  },
});
