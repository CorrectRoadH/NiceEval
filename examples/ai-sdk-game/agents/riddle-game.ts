import { defineAgent } from "fasteval";
import type { StreamEvent } from "fasteval";
// 需要安装: npm install ai @ai-sdk/openai
// import { generateText } from "ai";
// import { openai } from "@ai-sdk/openai";

// ─────────────────────────────────────────────────────────
// 谜语游戏的系统提示。
//
// 这就是「游戏逻辑」——用 AI SDK 实现的游戏 master。
// 它决定游戏规则，fasteval 负责自动化地和它对话、断言行为。
// ─────────────────────────────────────────────────────────
const GAME_SYSTEM_PROMPT = `
你是一个谜语游戏主持人。

规则：
1. 当玩家说 "出题" 时，生成一个关于日常物品或自然现象的谜语（不超过 3 句描述，不能直接说出谜底）。
2. 当玩家猜一个答案时，判断对错：
   - 答对：回复 "答对了！谜底就是 [答案]。"
   - 答错：回复 "猜错了，再想想。" 然后给一个不直接泄露答案的提示。
3. 当玩家说 "提示" 时，给一个额外提示，但绝对不能直接说出谜底。
4. 当玩家说 "放弃" 时，公布谜底。

始终保持友好、简短的风格，每次回复不超过 3 句话。
`.trim();

// ─────────────────────────────────────────────────────────
// 游戏会话状态（多轮对话用）。
//
// 在真实项目里，这通常存在数据库或 Redis；
// 例子里用进程内 Map 模拟，够 fasteval 多轮 eval 用。
// ─────────────────────────────────────────────────────────
const sessions = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

function getHistory(sessionId: string) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId)!;
}

// ─────────────────────────────────────────────────────────
// fasteval Agent 适配器。
//
// defineAgent（remote / 进程内）：send 里直接调 AI SDK，
// 不需要启动独立服务器——适合「函数即 agent」的场景。
//
// 如果你的游戏是 HTTP 服务，把 generateText(...) 换成 fetch(...)，
// 详见 README.md 的「适配 HTTP 服务」一节。
// ─────────────────────────────────────────────────────────
export const riddleGameAgent = defineAgent({
  name: "riddle-game",
  capabilities: {
    conversation: true,       // 支持多轮 t.send(...)
    toolObservability: false, // 这个游戏不暴露工具调用
  },

  async send(input, ctx) {
    // session id 由 fasteval 运行器分配（ctx.session.id），首轮为 undefined。
    const sessionId = ctx.session.id ?? `riddle-${Math.random().toString(36).slice(2)}`;
    ctx.session.id = sessionId;

    const history = getHistory(sessionId);
    history.push({ role: "user", content: input.text });

    // ── 实际调用 AI SDK ──────────────────────────────
    // 真实使用时取消注释：
    //
    // const { text } = await generateText({
    //   model: openai(ctx.model ?? "gpt-4o-mini"),
    //   system: GAME_SYSTEM_PROMPT,
    //   messages: history,
    //   abortSignal: ctx.signal,
    // });
    //
    // 例子里用 mock 模拟，让 eval 可以在没有 API key 时运行：
    const text = mockGameResponse(input.text, history);
    // ─────────────────────────────────────────────────

    history.push({ role: "assistant", content: text });

    const events: StreamEvent[] = [
      { type: "message", role: "assistant", text },
    ];

    return { events, status: "completed" };
  },

  teardown(_sb, ctx) {
    // 清理 session 数据
    if (ctx.session.id) sessions.delete(ctx.session.id);
  },
});

// ─────────────────────────────────────────────────────────
// Mock 实现（例子用）。
//
// 真实项目里删掉这个函数，用上面的 generateText 调用。
// ─────────────────────────────────────────────────────────
function mockGameResponse(
  input: string,
  history: Array<{ role: string; content: string }>,
): string {
  const text = input.toLowerCase();

  if (text.includes("出题")) {
    return "谜语来了：我有眼睛却看不见，有嘴巴却不说话，每天陪你看世界，却从不替你做决定。我是什么？";
  }

  if (text.includes("镜子") || text.includes("镜")) {
    return "答对了！谜底就是镜子。";
  }

  if (text.includes("眼镜") || text.includes("窗户") || text.includes("电视")) {
    return "猜错了，再想想。提示：你每天都要用它，它会如实反映你的样子，但不会替你做任何判断。";
  }

  if (text.includes("提示")) {
    const prevRiddle = history.some((m) => m.content.includes("看世界"));
    if (prevRiddle) {
      return "提示：它挂在墙上，有时候也握在手里，里面住着另一个「你」。";
    }
    return "请先说「出题」让我出一道谜语吧！";
  }

  if (text.includes("放弃")) {
    return "好的，谜底是「镜子」。再来一道？";
  }

  return "还没猜到？再想想，或者说「提示」让我帮你。";
}

export default riddleGameAgent;
