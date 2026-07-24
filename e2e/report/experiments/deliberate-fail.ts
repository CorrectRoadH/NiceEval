import { defineExperiment } from "niceeval";
import { aiSdkAgent } from "niceeval/adapter";
import { generateText, type ModelMessage } from "ai";
import { resolveModel } from "../src/model.ts";

const agent = aiSdkAgent<ModelMessage>({
  name: "results-deliberate-fail",
  generate: ({ messages, model, signal }) =>
    generateText({ model: resolveModel(model ?? "gpt5.6-luna"), messages, abortSignal: signal }),
});

// Never calls the real gateway (deliberate-fail.eval.ts doesn't send). Exists to produce
// a deterministic `failed` verdict for the JUnit `<failure>` folding assertion.
export default defineExperiment({
  description: "deliberate-fail:确定性 failed 判定,验证 JUnit <failure> 折叠",
  agent,
  evals: ["deliberate-fail"],
});
