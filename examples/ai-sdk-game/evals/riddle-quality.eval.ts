import { defineEval } from "fasteval";
import { includes, excludes } from "fasteval/expect";

// 评测：游戏出的谜题质量是否合格？
//
// 合格谜题的标准：
// 1. 有描述性语句（不是直接给出名字）
// 2. 不直接说出谜底
// 3. 游戏主持人接受「出题」指令并真的出了一道题
export default defineEval({
  description: "谜语游戏：出题质量",

  async test(t) {
    const turn = await t.send("出题");
    turn.expectOk();

    await t.group("游戏出了一道谜题", () => {
      // 回复应该是描述性的句子，有疑问结尾（"我是什么" / "猜猜我是谁" 等）
      t.check(t.reply, includes(/我是什么|猜猜|是什么|什么东西/));
    });

    await t.group("谜题没有直接泄露谜底", () => {
      // 出题时不应该出现「谜底是」「答案是」这样的字样
      t.check(t.reply, excludes(/谜底是|答案是/));
    });

    // 开放式质量评测：judge 模型读谜题打分
    t.judge
      .score("这道谜语是否合理？描述是否足够形象？难度是否适中（不太难也不太简单）？")
      .atLeast(0.6);

    t.judge.closedQA("这道谜语有描述性内容，没有直接给出谜底吗？").atLeast(0.8);
  },
});
