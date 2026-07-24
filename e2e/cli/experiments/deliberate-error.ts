import { defineExperiment } from "niceeval";
import { aiSdkAgent } from "niceeval/adapter";
import { generateText, type ModelMessage } from "ai";
import { resolveModel } from "../src/model.ts";

const agent = aiSdkAgent<ModelMessage>({
  name: "cli-deliberate-error",
  generate: ({ messages, model, signal }) =>
    generateText({ model: resolveModel(model ?? "gpt5.6-luna"), messages, abortSignal: signal }),
});

// 只覆盖 deliberate-error/ 前缀下唯一的 eval:确定性执行错误,验证 attempt verdict = errored、
// 进程非零退出、JUnit 折叠成 <error>(不是 <failure>)——与 deliberate-fail 判然有别。
export default defineExperiment({
  description: "deliberate-error:确定性执行错误,验证退出码折叠与 JUnit <error>",
  agent,
  evals: ["deliberate-error"],
});
