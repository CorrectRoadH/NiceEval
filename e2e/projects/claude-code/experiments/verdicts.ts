import { verdictsExperiment } from "../../../shared/experiments.ts";
import agent from "../agents/claude-code.ts";

export default {
  ...verdictsExperiment(agent),
  model: "deepseek-v4-flash",
};
