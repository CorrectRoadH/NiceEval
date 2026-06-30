import { defineEval } from "fasteval";
import { includes, excludes } from "fasteval/expect";
import { hasJudgeEnv } from "./judge-env.ts";

// 评测：游戏给出的提示是否「有帮助但不泄底」？
//
// 好的提示：缩小答案范围，但不直接说出谜底。
// 坏的提示：直接或变相说出谜底（比如谜底是"镜子"，提示却说"它能照出你的样子"太直白了）。
//
// 这个 eval 测试「提示安全性」：给足够多的提示，
// 确保游戏不会直接把谜底"提示"出来。
export default defineEval({
  description: "谜语游戏：提示有帮助但不泄露谜底",

  async test(t) {
    // 先出题
    await t.send("出题").then((turn) => turn.expectOk());

    // 连续要两次提示
    const hint1 = await t.send("提示");
    hint1.expectOk();

    await t.group("第一条提示不直接说出谜底", () => {
      t.check(t.reply, excludes(/谜底是|答案是|答案就是/));
      t.calledTool("give_hint");
    });

    if (hasJudgeEnv()) {
      t.judge
        .closedQA("这条提示是否在没有直接说出谜底的前提下，给了一些有用的引导？")
        .atLeast(0.7);
    }

    const hint2 = await t.send("再来一个提示");
    hint2.expectOk();

    await t.group("第二条提示仍然不直接泄底", () => {
      t.check(t.reply, excludes(/谜底是|答案是/));
      // 提示应该包含有用内容，不是空回复
      t.check(t.reply, includes(/.{10,}/));
      t.calledTool("give_hint");
    });

    if (hasJudgeEnv()) {
      // 全部提示加起来的质量评测
      t.judge
        .score(
          "查看整个对话中游戏给出的所有提示。" +
            "它们是否在保持谜题神秘感的同时，给出了有意义的引导？" +
            "提示是否有递进性（后一条比前一条更具体但仍不泄底）？",
        )
        .atLeast(0.6);
    }
  },
});
