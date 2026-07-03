// 真实 agent：用 pi SDK(@earendil-works/pi-agent-core 的 Agent + @earendil-works/pi-ai
// 的模型/provider)搭建，不再是手写的 tool-calling 循环。
//
// 默认走 DeepSeek(deepseekProvider() 的模型目录里已经有 deepseek-v4-flash /
// deepseek-v4-pro，鉴权自动读 DEEPSEEK_API_KEY，见 .env.example)，可通过
// AGENT_MODEL 切换到 deepseek-v4-pro 等同目录下的模型。
//
// 每次 /api/chat 请求都 new 一个 Agent(见 createAgent)——不维护跨请求的会话状态，
// 这一点和被替换掉的旧 agent.ts 一致(旧版 runAgent(message) 也是每次从零拼
// messages 数组，没有多轮历史)。
import { Agent, type AgentOptions } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { calculateTool, getWeatherTool } from "./tools.ts";

const models = createModels();
models.setProvider(deepseekProvider());

const MODEL_ID = process.env.AGENT_MODEL ?? "deepseek-v4-flash";

function resolveModel() {
  const model = models.getModel("deepseek", MODEL_ID);
  if (!model) {
    throw new Error(
      `未知模型: deepseek/${MODEL_ID}。deepseekProvider() 的目录里目前有 deepseek-v4-flash / deepseek-v4-pro。`,
    );
  }
  return model;
}

const SYSTEM_PROMPT = "你是一个能查天气、能做算术的助理。需要时调用工具，不要自己瞎编数字。";

export interface CreateAgentOptions {
  /** 转发给 pi 的 beforeToolCall——server.ts 用它给 calculate 挂 HITL 审批。 */
  beforeToolCall?: AgentOptions["beforeToolCall"];
}

/** 每次 /api/chat 调用都 new 一个全新 Agent：无状态，见文件头注释。 */
export function createAgent(options: CreateAgentOptions = {}): Agent {
  return new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: resolveModel(),
      tools: [getWeatherTool, calculateTool],
    },
    // Agent 默认会用 @earendil-works/pi-ai/compat 里的全局 streamSimple，这里显式绑定
    // 我们自己建的 models(只注册了 deepseek provider)，保证鉴权走的是上面 setProvider
    // 的那个 provider 实例。
    streamFn: models.streamSimple.bind(models),
    beforeToolCall: options.beforeToolCall,
  });
}
