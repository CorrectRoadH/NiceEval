import { completeCoverage, defineAgent } from "niceeval/adapter";
import type { Agent } from "niceeval/adapter";

/** 确定性 remote mock agent:不联网,秒回固定文本,恒定成功。 */
export function mockAgent(): Agent {
  return defineAgent({
    name: "cli-profile-mock-agent",
    // 这份确定性 fixture 直接构造完整 Turn,不是无法证明完整性的旧 Adapter。
    coverage: completeCoverage,
    async send() {
      return {
        status: "completed" as const,
        events: [{ type: "message" as const, role: "assistant" as const, text: "ok" }],
        usage: { inputTokens: 1, outputTokens: 1, requests: 1 },
      };
    },
  });
}
