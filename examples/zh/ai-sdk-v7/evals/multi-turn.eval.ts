import { defineEval } from "niceeval";
import type { StreamEvent } from "niceeval";

// 【T2 多轮会话】同一 session 里第二轮能记住第一轮;t.newSession() 开出的新会话
// 则必须是干净的 —— adapter 忽略 isNew 一律 resume 的话,这条隔离断言会当场暴露。
export default defineEval({
  description: "T2:会话记忆跨轮保持,newSession 与主会话隔离",

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
