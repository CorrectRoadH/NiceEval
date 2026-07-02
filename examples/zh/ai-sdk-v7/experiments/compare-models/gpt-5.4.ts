import { defineExperiment } from "niceeval";
import { assistant } from "../assistant.ts";

// compare-models 组的一格:gpt-5.4。与 deepseek-v4-pro.ts 钉住一切、只差 model,
// 差异才干净归因到模型这一个轴。gpt-5.4 支持视觉,image-understanding 只在这格真跑。
export default defineExperiment({
  description: "gpt-5.4:对比模型",
  agent: assistant,
  model: "gpt-5.4",
  runs: 2,
  earlyExit: true,
  budget: 5,
});
