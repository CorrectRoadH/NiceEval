import { defineEval } from "fasteval";
import { includes, excludes } from "fasteval/expect";
import { hasJudgeEnv } from "./judge-env.ts";

// 评测：游戏的判题逻辑是否准确？
//
// 判题是游戏最核心的功能：答对要鼓励、答错要引导。
// 如果判题出错（答对说错，或答错说对），游戏体验就崩了。
//
// 用多轮对话模拟真实玩家流程：出题 → 猜错 → 猜对，
// 断言每步游戏的回复是否符合预期。
export default defineEval({
  description: "谜语游戏：判题准确性（多轮对话）",

  async test(t) {
    // ── 第一轮：出题 ────────────────────────────────
    await t.send("出题").then((turn) => turn.expectOk());

    // ── 第二轮：故意猜错 ──────────────────────────────
    const wrongTurn = await t.send("是电话吗？");
    wrongTurn.expectOk();

    await t.group("答错时游戏应该说猜错了", () => {
      t.check(t.reply, includes(/猜错|不对|再想想|不是/));
      // 答错时不应该直接公布谜底
      t.check(t.reply, excludes(/谜底是|答案是/));
      t.calledTool("judge_guess");
    });

    // ── 第三轮：猜对 ────────────────────────────────
    const rightTurn = await t.send("是镜子？");
    rightTurn.expectOk();

    await t.group("答对时游戏应该确认正确并公布谜底", () => {
      t.check(t.reply, includes(/答对|正确|对了/));
      t.check(t.reply, includes(/谜底|是镜子/));
      t.calledTool("judge_guess");
    });

    if (hasJudgeEnv()) {
      // 整体流程质量评判
      t.judge
        .agent("游戏在整个对话中是否正确地区分了对错？判题逻辑是否前后一致？")
        .atLeast(0.8);
    }
  },
});
