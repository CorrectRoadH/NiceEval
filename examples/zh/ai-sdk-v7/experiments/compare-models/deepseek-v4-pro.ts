import { defineExperiment } from "niceeval";
import { aiSdkAgent } from "niceeval/adapter";
import { assistant } from "../../agent/assistant.ts";

// compare-models 组的一格:deepseek-v4-pro。
//
// 一文件一配置(单 model)。要跨模型对比就在本文件夹里再加一个文件(各钉一个 model),
// 别在一个实验里塞 model 数组。跑 `niceeval exp compare-models` 会把同组各 model 并排出报告。
//
// agent 用 niceeval 内建的 aiSdkAgent 工厂 —— 进程内直调,不需要先起服务;
// 应用只提供 assistant(generate + data),会话 / 事件流 / HITL 都是工厂的事。
// model 由实验钉住,经 ctx.model 传进 generate —— 应用自己不配模型。
export default defineExperiment({
  description: "deepseek-v4-pro:对比模型",
  agent: aiSdkAgent(assistant),
  model: "deepseek-v4-pro",
  runs: 2,          // 最多跑 2 次
  earlyExit: true,  // 2 次里通过一次就停,省 token
  budget: 5,        // $5 上限
});
