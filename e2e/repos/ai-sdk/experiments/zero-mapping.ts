import { defineExperiment } from "niceeval";
import { DEFAULT_MODEL } from "../src/backend/models.ts";
import agent from "../agents/zero-mapping.ts";

export default defineExperiment({
  description: "zero-mapping:直接在 generateText() 调用结果上使用 fromAiSdk(result),中间不经过 factory",
  agent,
  model: DEFAULT_MODEL,
  runs: 3,
  earlyExit: true,
  evals: (id) => id.startsWith("zero-mapping/"),
  budget: 1,
});
