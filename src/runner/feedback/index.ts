// `niceeval exp` 的 human / agent / ci 反馈模型:公开入口。
// 见 docs/feature/experiments/cli.md,承重设计见 plan/exp-output-feedback-models.md 第 2-3 节。
//
// - profile.ts   —— `--output auto` 的纯环境判定。
// - reducer.ts   —— 事件 → RunFeedbackState 的纯 reducer(与本文件同目录,类型见 ../types.ts)。
// - renderer.ts  —— human/agent/ci 各实现一份的插件契约。
// - coordinator.ts —— 一个 run 内唯一的终端协调者,renderer 的唯一调用方。
// - sink.ts      —— 供尚未拿到 coordinator 引用的底层模块(sandbox provider、budget 记账、
//                    reporter 兜底……)使用的迁移出口。
// - io.ts        —— 可注入的终端 I/O 面;testing.ts(仅测试用,不在这个条形码出口里)提供假实现。

export { resolveOutputProfile, isCIEnvironment, type OutputProfileFlag, type ResolveOutputProfileInput } from "./profile.ts";
export { createInitialRunFeedbackState, reduceRunFeedback } from "./reducer.ts";
export type { FeedbackRenderer } from "./renderer.ts";
export {
  createFeedbackCoordinator,
  type FeedbackCoordinator,
  type FeedbackCoordinatorOptions,
} from "./coordinator.ts";
export {
  reportActivity,
  reportDiagnostic,
  reportInterrupted,
  reportReporterError,
  reportAttemptLifecycle,
  reportFailure,
  reportBudgetExhausted,
  activateFeedbackSink,
  activeFeedbackSinkCount,
  type DiagnosticInput,
  type FailureInput,
  type BudgetExhaustedInput,
  type FeedbackSink,
} from "./sink.ts";
export {
  createNodeFeedbackIO,
  type FeedbackIO,
  type FeedbackStream,
  type FeedbackClock,
  type FeedbackTimerHandle,
} from "./io.ts";
export {
  createHumanRenderer,
  renderDurableLines,
  renderHumanDryPlan,
  formatElapsed,
  formatTokenCount,
  type HumanRendererOptions,
  type HumanDryPlanInput,
  type HumanDryPlanRow,
} from "./human.ts";
export {
  createAgentRenderer,
  renderAgentPlanEnvelope,
  type AgentRendererOptions,
  type AgentDryPlanInput,
  type AgentPlanRow,
} from "./agent.ts";
export {
  createCiRenderer,
  computeCiExitCode,
  renderCiDryPlan,
  type CiRendererOptions,
  type CiDryPlanInput,
  type CiDryPlanRow,
} from "./ci.ts";
