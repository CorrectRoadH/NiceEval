import { defineEval } from "niceeval";

// 这条 eval 验证 agent 能正常问答、不瞎调工具。usage 从 LangSmith 的 llm 类型 span 聚合
// (src/o11y/otlp/dialects.ts 的 langsmith 方言),不用 adapter 自己算。
export default defineEval({
  description: "测试 agent 能正常问答且不瞎调工具",

  async test(t) {
    const turn = await t.send("用一句话介绍一下你自己,这轮不用查天气也不用算数。");
    turn.expectOk();

    await t.group("正常收发、没有多余工具调用", () => {
      t.succeeded();
      t.usedNoTools();
    });

    t.maxTokens(20_000);
  },
});
