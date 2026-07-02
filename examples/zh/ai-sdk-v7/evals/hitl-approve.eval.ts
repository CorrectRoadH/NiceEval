import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

// 【HITL 批准】send_email 带 needsApproval:模型决定发邮件时,AI SDK 停轮等人批准,
// fromAiSdk 把它映射成 status "waiting" + input.requested 事件。eval 侧的三步握手:
// requireInputRequest 取出请求 → respond("approve") 交回裁决 → 工具真正执行。
export default defineEval({
  description: "HITL:发邮件停在人工批准上,approve 后工具真正执行",

  async test(t) {
    const first = await t.send(
      "给 zhangsan@example.com 发一封邮件,主题是「评审会改期」,正文说明天的评审会改到下午三点。",
    );

    await t.group("第一轮停在人工批准上", () => {
      t.check(first.status, equals("waiting"));
      first.event("input.requested");
      first.calledTool("send_email"); // 调用已发起,只是还没被放行
    });

    // 恰好一个待批准请求,且停在 send_email 上;filter 逐字段匹配 InputRequest。
    const req = t.requireInputRequest({ action: "send_email", optionIds: ["approve", "deny"] });
    t.check((req.input as { to?: string })?.to ?? "", includes("zhangsan@example.com"));

    const second = await t.respond("approve");
    second.expectOk();

    await t.group("批准后工具执行、回复交代结果", () => {
      // called(第一轮)与 result(第二轮)按 callId 跨轮配对,status 是最终态。
      t.calledTool("send_email", { status: "completed", input: { to: /zhangsan/ } });
      t.noFailedActions();
      t.succeeded();
      t.eventOrder(["input.requested", "action.result", "message"]);
    });

    t.judge.autoevals
      .closedQA("助手是否在邮件发出后明确告知用户邮件已发送(而不是含糊其辞或说没发)?")
      .atLeast(0.7);
  },
});
