import { defineExperiment } from "niceeval";
import { defineSandbox } from "niceeval/sandbox";
import { defineSandboxAgent } from "niceeval/adapter";
import { createFakeSandbox } from "../../lib/fake-sandbox.ts";
import { logEvent } from "../../lib/log.ts";

// 全序回归:sandbox.setup(a,b) → eval 主体驱动的 agent.setup → send → agent.teardown →
// sandbox.setup 返回的 cleanup(LIFO)→ sandbox.teardown(x,y 逆序 = y 先 x 后)。
// 每个钩子把 ctx.experimentId 一并记下,顺带验证它在同一 attempt 内处处一致、非空。
const sandbox = defineSandbox({
  name: "fake-order",
  create: async () => createFakeSandbox(),
})
  .setup(async (_sb, ctx) => {
    await logEvent("sandbox:setup:a", ctx.experimentId);
    return async () => {
      await logEvent("sandbox:cleanup:a", ctx.experimentId);
    };
  })
  .setup(async (_sb, ctx) => {
    await logEvent("sandbox:setup:b", ctx.experimentId);
  })
  .teardown(async (_sb, ctx) => {
    await logEvent("sandbox:teardown:x", ctx.experimentId);
  })
  .teardown(async (_sb, ctx) => {
    await logEvent("sandbox:teardown:y", ctx.experimentId);
  });

const agent = defineSandboxAgent({
  name: "order-agent",
  async setup(_sb, ctx) {
    await logEvent("agent:setup", ctx.experimentId);
  },
  async send(_input, ctx) {
    await logEvent("agent:send", ctx.experimentId);
    return {
      status: "completed" as const,
      events: [{ type: "message" as const, role: "assistant" as const, text: "ok" }],
      usage: { inputTokens: 1, outputTokens: 1, requests: 1 },
    };
  },
  async teardown(_sb, ctx) {
    await logEvent("agent:teardown", ctx.experimentId);
  },
});

export default defineExperiment({
  description: "回归夹具:sandbox 钩子全序 + ctx.experimentId",
  agent,
  sandbox,
  model: "mock-order",
  runs: 1,
  earlyExit: false,
  evals: ["order"],
});
