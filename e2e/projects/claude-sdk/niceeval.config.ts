import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: claude-sdk(fromClaudeSdkMessages)", en: "e2e: claude-sdk (fromClaudeSdkMessages)" },
  judge: { model: "gpt-5.4" },
  timeoutMs: 120_000,
  // 钉死串行(不是"偏保守",是必须):两个并发 HITL 审批打同一个 server 实例时
  // POST /api/chat/approve 会对其中一个 toolUseId 永久 404,
  // 见 memory/claude-sdk-concurrent-hitl-approve-race.md。
  maxConcurrency: 1,
});
