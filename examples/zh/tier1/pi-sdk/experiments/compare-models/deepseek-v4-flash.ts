import { defineExperiment } from "niceeval";
import agent from "../../agents/pi-sdk.ts";

// compare-models 组的一格:deepseek-v4-flash。一文件一配置(单 model),
// 差异干净归因到模型这一个轴。model 经 ctx.model → AGENT_MODEL 注入独立的 server 进程
// (pi 的模型只能在进程启动时读一次,见 agents/server-lifecycle.ts 头注释)。
export default defineExperiment({
  description: "deepseek-v4-flash: 对比模型",
  agent,
  model: "deepseek-v4-flash",
  runs: 2,
  earlyExit: true, // 2 次里通过一次就停,省 token
  budget: 2, // $2 上限
});
