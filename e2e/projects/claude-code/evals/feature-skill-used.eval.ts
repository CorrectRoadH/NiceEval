import { skillUsed } from "../../../shared/evals.ts";
import profile from "../profile.ts";

// "feature-" 前缀:只有挂了 skills 的 agent(agents/claude-code-features.ts)才可能过,
// 只进 experiments/features.ts,ci.ts 显式排除(见 shared/experiments.ts 的 excludeIdPrefixes)。
export default skillUsed(profile);
