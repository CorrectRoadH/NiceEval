import { defineEval } from "niceeval";

export default defineEval({
  description: "sandbox 钩子全序回归",
  async test(t) {
    const turn = await t.send("hi");
    turn.expectOk();
    t.succeeded();
  },
});
