// eval 侧的全部接线:内建 aiSdkAgent 工厂 + 应用的 chat 函数。niceeval 的东西只出现在
// 这个目录 —— 应用代码(agent/)不 import 任何 eval 框架的类型。
//
// 会话历史、事件流、HITL 握手、失败兜底、OTel 管线(per-attempt 端点、轮末 flush)全部
// 是工厂的事;这里只声明「怎么召模型」(generate)和「结构化输出取什么」(data)。
// 没有 default export,所以 niceeval 的实验发现会跳过本文件。
import { aiSdkAgent } from "niceeval/adapter";
import type { ModelMessage } from "ai";
import { chat } from "../agent/assistant.ts";

export const assistant = aiSdkAgent<ModelMessage>({
  name: "ai-sdk-v7",
  // tracing:声明后 niceeval 起本机 OTLP 接收器,工厂把绑定端点的 telemetry 交给 generate,
  // chat 原样透传即可(trace 瀑布图在 `niceeval view` 里看)。
  capabilities: { tracing: true },
  // 可选双发:设了 OTLP_BACKEND_URL(Langfuse / SigNoz / 生产 collector)时,
  // 同一批 span 也发到你自己的观测后端。
  otlpBackendUrl: process.env.OTLP_BACKEND_URL,

  generate: ({ messages, model, signal, telemetry }) => chat(messages, model, { signal, telemetry }),

  // T0 结构化输出(Turn.data):最终回复 + 本轮最后一个动作(evals 里 outputMatches 用)。
  data: (result, turn) => ({
    reply: result.text ?? "",
    lastAction:
      [...turn.events].reverse().find((e) => e.type === "action.called")?.name ?? "chat",
  }),
});
