import { defineConfig } from "fasteval";
import { riddleGameAgent } from "./agents/riddle-game.ts";

export default defineConfig({
  // 游戏是进程内 agent,不需要 Docker 沙箱。
  // 如果你的游戏是 HTTP 服务,这里不需要改,只需设 GAME_URL 环境变量。
  sandbox: "auto",

  // 把游戏 agent 注册进来,让 eval 可以用名字引用。
  agents: [riddleGameAgent],
  defaultAgent: "riddle-game",

  // judge 模型:用来做开放式质量评测(谜题是否合理、提示是否得当)。
  judge: { model: "gpt-4o-mini" },

  timeoutMs: 60_000,    // 进程内调用很快,60s 足够
  maxConcurrency: 4,    // 并发跑 4 个 eval
});
