// `--output auto` 的纯环境判定(见 docs/feature/experiments/cli.md「三种反馈模型」)。
// 只依赖调用方传入的 isTTY/env,不读全局 `process` —— CLI flag 解析层(--output 本身的
// 语法校验、非法值报错)不在这里,那是 flag 解析层的职责;这里只处理「已知合法输入」到
// 「三选一 profile」的映射,好让这条判定可以脱离真实终端/环境变量单测。

import type { OutputProfile } from "../types.ts";

/** `--output` 显式值的合法输入,含默认值 `"auto"`。 */
export type OutputProfileFlag = OutputProfile | "auto";

export interface ResolveOutputProfileInput {
  /** 已解析、已校验的 --output 值。 */
  explicit: OutputProfileFlag;
  /** 通常取 `stderr.isTTY`(见 docs:human dashboard 依赖 stderr 可交互重画,不是 stdout)。 */
  isTTY: boolean;
  env: Readonly<Record<string, string | undefined>>;
}

/**
 * 常见 CI 平台会设置的环境变量标记,命中任意一个即视为 CI 环境。`CI` 是事实标准
 * (GitHub Actions / GitLab CI / CircleCI / Travis CI / Buildkite / Vercel 等均会设置);
 * 其余是没有通用 `CI` 变量、或希望在缺失 `CI=true` 时也能命中的平台专属兜底。列表只在
 * 这里维护一份 —— `isCIEnvironment` 的测试逐项覆盖,新增平台直接加进这个数组。
 */
const CI_ENV_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
  "APPVEYOR",
  "TF_BUILD", // Azure Pipelines
] as const;

/** 值为空串 / "false" / "0" 视为未设置 —— 本地开发者 shell 里 `export CI=false` 之类的
 *  显式关闭不该被误判成「在 CI 里」。 */
function isSetTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "false" && value !== "0";
}

export function isCIEnvironment(env: Readonly<Record<string, string | undefined>>): boolean {
  return CI_ENV_VARS.some((name) => isSetTruthy(env[name]));
}

/**
 * 优先级:显式值 > stderr 是否 TTY > CI 环境标记 > 其余一律 agent(见 docs 的三行判定表)。
 * TTY 检查先于 CI 环境标记 —— 显式在伪 TTY(如 CI 平台分配了 pty 的场景)里跑仍希望拿到
 * 人可读的 dashboard,只有确认不是 TTY 之后才继续问「是不是 CI」。
 */
export function resolveOutputProfile(input: ResolveOutputProfileInput): OutputProfile {
  if (input.explicit !== "auto") return input.explicit;
  if (input.isTTY) return "human";
  if (isCIEnvironment(input.env)) return "ci";
  return "agent";
}
