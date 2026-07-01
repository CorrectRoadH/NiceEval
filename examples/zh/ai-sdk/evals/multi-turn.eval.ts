import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

// 这条 eval 验证同一个 session 里连续发消息时，agent 能保持会话并在需要时调用工具。
//
// 第一轮是纯文本算术，检查上一轮回复会被 t.reply 正确暴露出来。
// 第二轮切到实时天气，检查同一会话里的后续问题仍能触发 get_weather。
export default defineEval({
  description: "测试 agent 在多轮对话中保持会话并按需调用工具的能力",

  async test(t) {
    await t.send("1+1=?");
    t.succeeded();
    t.check(t.reply, includes("2"));

    const second = await t.send("北京今天天气怎么样？");
    t.calledTool("get_weather", { input: { city: "北京" } });
    second.messageIncludes("北京");

    t.judge.autoevals.closedQA("是否先正确回答了 1+1=2，又基于天气工具回答了北京天气问题？").gate(0.8);
  },
});
