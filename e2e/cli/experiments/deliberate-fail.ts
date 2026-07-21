import { defineExperiment } from "niceeval";
import { aiSdkAgent } from "niceeval/adapter";
import { generateText, type ModelMessage } from "ai";
import { resolveModel } from "../src/model.ts";

const agent = aiSdkAgent<ModelMessage>({
  name: "cli-deliberate-fail",
  generate: ({ messages, model, signal }) =>
    generateText({ model: resolveModel(model ?? "deepseek-v4-flash"), messages, abortSignal: signal }),
});

// 只覆盖 deliberate-fail/ 前缀下唯一的 eval:确定性失败断言,验证 attempt verdict = failed、
// 进程非零退出、JUnit 折叠成 <failure>(不是 <error>)。
export default defineExperiment({
  description: "deliberate-fail:确定性失败断言,验证退出码折叠与 JUnit <failure>",
  agent,
  evals: ["deliberate-fail"],
});
