import { defineEval } from "niceeval";
import type { StreamEvent } from "niceeval";

// 会话记忆能不能跨轮:server.ts 每轮都是一个新的 Claude Agent SDK CLI 子进程(query()),
// 记忆完全靠上一轮 result 消息带回来的 session_id 做 --resume,而不是进程内状态。
// agents/claude-sdk.ts 把这个 session_id 写回 ctx.session.id,下一轮 t.send 再传回去
// —— 这条 eval 验证这条链路真的通,t.newSession() 开的新会话也确实互相隔离。
export default defineEval({
  description: "同一 session 里第二轮记得第一轮;newSession 隔离",

  async test(t) {
    (await t.send("请记住:我的项目代号是「蓝鲸」。")).expectOk();
    const second = await t.send("我的项目代号是什么?");
    second.expectOk();

    await t.group("第二轮记得第一轮的内容", () => {
      second.messageIncludes("蓝鲸");
      t.succeeded();
    });

    const fresh = t.newSession();
    (await fresh.send("我的项目代号是什么?")).expectOk();

    await t.group("新会话不共享主会话的上下文", () => {
      fresh.eventsSatisfy(
        (events: readonly StreamEvent[]) =>
          !events.some((e) => e.type === "message" && e.role === "assistant" && e.text.includes("蓝鲸")),
        "新会话不知道「蓝鲸」",
      );
    });
  },
});
