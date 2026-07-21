import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
});

// 基线 agent:coding-task(文件/shell 工具轨)+ session-resume(原生 resume + usage)。
export default defineExperiment({
  description: "coding:基线 claude-code agent —— coding-task 工具轨 + session resume/usage",
  agent,
  model: "deepseek-v4-flash",
  runs: 1,
  evals: (id) => id === "coding-task" || id === "session-resume",
});
