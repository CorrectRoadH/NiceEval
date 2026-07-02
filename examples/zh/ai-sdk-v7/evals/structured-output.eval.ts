import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";
import { z } from "zod";

// 【T0 结构化输出】adapter 把 { reply, lastAction } 放进 Turn.data —— 与事件流互相独立,
// outputMatches 用 zod schema 校验形状,check + equals/includes 做值级断言。
export default defineEval({
  description: "T0:精确计算走 calculate,结构化输出经 data 校验",

  async test(t) {
    const turn = await t.send("帮我算 (3+4)*6 等于多少");
    turn.expectOk();

    await t.group("结构化输出形状与取值", () => {
      turn.outputMatches(z.object({ reply: z.string().min(1), lastAction: z.string() }));
      t.check((turn.data as { lastAction: string }).lastAction, equals("calculate"));
    });

    await t.group("答案来自工具而不是心算", () => {
      t.calledTool("calculate");
      t.check(t.reply, includes("42"));
    });
  },
});
