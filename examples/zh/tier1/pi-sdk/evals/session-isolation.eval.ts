import { defineEval } from "niceeval";
import { includes, excludes } from "niceeval/expect";

// 这条 eval 专门验证 conversation 能力位的两半承诺:同一 session 里第二轮记得住第一轮说的名字
// (server.ts 内存 Map<sessionId, AgentMessage[]> 续接成功);t.newSession() 造出的新 session
// 不共享历史(常见 bug:adapter 忽略 ctx.session.isNew 一律续接,隔离会静默失真且不报错)。
export default defineEval({
  description: "测试跨轮记忆与 newSession() 隔离",

  async test(t) {
    await t.send("我叫小明,帮我记住这个名字。");
    const recall = await t.send("我刚才说我叫什么名字?");
    recall.messageIncludes("小明");
    t.check(t.reply, includes("小明"));

    const fresh = t.newSession();
    await fresh.send("我叫什么名字?");
    // 新 session 没有历史,不应该知道"小明"这个事实——用 fresh.* 只看这条新 session 自己的事件,
    // 不是 t.*(t.* 是 run 级聚合,会同时看到主 session 的事件)。
    t.check(fresh.reply, excludes("小明"));
  },
});
