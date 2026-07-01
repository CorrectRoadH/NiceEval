import { defineEval } from "niceeval";

// 这条 eval 验证 agent 遇到实时天气问题时会走工具，而不是直接编一个答案。
//
// 关键检查有两层：先确认调用 get_weather 且 city 参数是北京，再确认最终回复确实使用了工具结果。
// judge 断言没有 judge key 时会自动跳过，保留它是为了在真实模型模式下补充语义评分。
export default defineEval({
  description: "测试 agent 在实时天气问题中正确调用工具并基于结果作答的能力",

  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    turn.expectOk();

    await t.group("调用 get_weather 且城市正确", () => {
      t.calledTool("get_weather", { input: { city: "北京" } });
      // 回复里要出现天气信息的可见证据，避免“调了工具但没有回答用户”的情况也通过。
      t.messageIncludes(/°C|气温|天气|晴|多云|雨/);
    });

    t.judge.autoevals
      .closedQA("助手是否基于工具返回的天气数据作答，而不是凭空编造温度？")
      .atLeast(0.7);
  },
});
