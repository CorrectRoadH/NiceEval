import { defineAgent } from "niceeval/adapter";
import type { Agent } from "niceeval/adapter";

// 确定性 mock agent:不管发了什么图片,永远用一句典型的"模型不支持视觉输入"拒绝语回复。
// 用来复现真实场景(见 examples/zh/ai-sdk 跑 deepseek-v4-pro 的记录):模型压根没看图,
// 但回复里天然带着"图片"/"颜色"这类泛词,足以让写得太松的 messageIncludes 正则误判通过。
export function refusalAgent(): Agent {
  return defineAgent({
    name: "refusal-agent",
    capabilities: { conversation: true },

    async send() {
      return {
        status: "completed" as const,
        events: [
          {
            type: "message" as const,
            role: "assistant" as const,
            text: "很抱歉，我目前使用的模型不支持图像输入，无法查看你发送的图片。建议你换用支持视觉功能的多模态模型，这样我就能帮你描述图片内容了。",
          },
        ],
        usage: { inputTokens: 40, outputTokens: 40, requests: 1 },
      };
    },
  });
}
