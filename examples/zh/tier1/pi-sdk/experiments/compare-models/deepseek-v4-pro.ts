import { defineExperiment } from "niceeval";
import agent from "../../agents/pi-sdk.ts";

// compare-models 组的一格:deepseek-v4-pro。与 deepseek-v4-flash.ts 钉住一切、只差 model。
export default defineExperiment({
  description: "deepseek-v4-pro: 对比模型",
  agent,
  model: "deepseek-v4-pro",
  runs: 2,
  earlyExit: true,
  budget: 2,
});
