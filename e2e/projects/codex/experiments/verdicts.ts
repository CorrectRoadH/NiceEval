import { verdictsExperiment } from "../../../shared/experiments.ts";
import agent from "../agents/codex.ts";

export default {
  ...verdictsExperiment(agent),
  model: "gpt-5.4-mini",
};
