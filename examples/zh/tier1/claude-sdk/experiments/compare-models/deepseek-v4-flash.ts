import { defineExperiment } from "niceeval";
import agent from "../../agents/claude-sdk.ts";

// compare-models 组的一格:deepseek-v4-flash。一文件一配置(单 model),
// model 经 ctx.model → AGENT_MODEL 注入独立的 server 进程(agent.ts 里的 MODEL 只在模块
// 加载时读一次,见 agents/server-lifecycle.ts 头注释)。
export default defineExperiment({
  description: "deepseek-v4-flash: 对比模型",
  agent,
  model: "deepseek-v4-flash",
  runs: 2,
  earlyExit: true,
  budget: 2,
});
