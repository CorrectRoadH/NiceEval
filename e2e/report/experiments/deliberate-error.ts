import { defineExperiment } from "niceeval";
import { aiSdkAgent } from "niceeval/adapter";
import { generateText, type ModelMessage } from "ai";
import { resolveModel } from "../src/model.ts";

const agent = aiSdkAgent<ModelMessage>({
  name: "results-deliberate-error",
  generate: ({ messages, model, signal }) =>
    generateText({ model: resolveModel(model ?? "deepseek-chat"), messages, abortSignal: signal }),
});

// Never calls the real gateway (deliberate-error.eval.ts throws before any send). Exists
// to produce a deterministic `errored` verdict for the JUnit `<error>` folding assertion,
// kept in its own Experiment so it never shares a JUnit file with deliberate-fail.
export default defineExperiment({
  description: "deliberate-error:确定性 errored 判定,验证 JUnit <error> 折叠",
  agent,
  evals: ["deliberate-error"],
});
