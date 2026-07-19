import { defineExperiment } from "niceeval";
import { DEFAULT_MODEL } from "../src/backend/models.ts";
import agent from "../agents/in-process.ts";

export default defineExperiment({
  description: "in-process:aiSdkAgent generate() 循环,tracing:接入 aiSdkOtel()(本仓库的 OTel 验证点)",
  agent,
  model: DEFAULT_MODEL,
  runs: 3,
  earlyExit: true,
  evals: (id) => id.startsWith("in-process/"),
  budget: 1,
});
