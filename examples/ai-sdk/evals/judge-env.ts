export function hasJudgeEnv(): boolean {
  return Boolean(process.env.FASTEVAL_JUDGE_KEY || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY);
}
