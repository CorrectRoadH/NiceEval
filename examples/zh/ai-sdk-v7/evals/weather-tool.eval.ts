import { defineEval } from "niceeval";

// 【T1 事件流】天气问题要走工具,不许编造 —— fromAiSdk 直构的事件流让整套作用域断言可用:
// 调用参数、调用顺序、失败状态、事件序,连负断言(notCalledTool)都因完整性可信。
export default defineEval({
  description: "T1:实时天气走 get_weather,参数、顺序、负断言、用量全部可断言",

  async test(t) {
    const turn = await t.send("北京今天天气怎么样?");
    turn.expectOk();

    await t.group("调用 get_weather 且城市正确", () => {
      t.calledTool("get_weather", { input: { city: "北京" } });
      t.toolOrder(["get_weather"]);
      t.noFailedActions();
      // 回复里要出现天气信息的可见证据,避免「调了工具但没回答用户」也通过。
      t.messageIncludes(/°C|气温|天气|晴|多云|雨/);
    });

    await t.group("负断言可信:没有误触发别的工具", () => {
      t.notCalledTool("send_email");
      t.notCalledTool("web_search");
      t.maxToolCalls(2);
    });

    await t.group("事件序与用量", () => {
      // 子序匹配:先发起调用、后拿到结果、最后才回复用户。
      t.eventOrder(["action.called", "action.result", "message"]);
      t.maxTokens(20_000);
      t.maxCost(0.05);
    });

    // 「是否走了工具」由上面的 calledTool 确定性把关;judge 只评回复本身的质量。
    t.judge.autoevals
      .closedQA("助手是否给出了具体的天气数据(温度或天气状况),而不是拒绝回答或含糊其辞?")
      .atLeast(0.7);
  },
});
