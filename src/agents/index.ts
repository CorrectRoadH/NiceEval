// niceeval/adapter 公开导出:「连到哪个 AI」相关的类型 + 内置 adapter + 自定义 adapter 的入口。

export { defineAgent, defineSandboxAgent } from "../define.ts";
export { shared } from "./shared.ts";
export type { Shared } from "./shared.ts";

export { fromAiSdk, aiSdkAgent } from "./ai-sdk.ts";
export type {
  AiSdkAgentOptions,
  AiSdkGenerateContext,
  AiSdkResultLike,
  AiSdkStepLike,
  AiSdkToolCallLike,
  AiSdkToolResultLike,
  AiSdkTurn,
  AiSdkUsageLike,
} from "./ai-sdk.ts";

export { BUILTIN_AGENTS } from "./builtin.ts";
export { claudeCodeAgent } from "./claude-code.ts";
export { codexAgent } from "./codex.ts";
export { bubAgent } from "./bub.ts";
export type { ClaudeCodeConfig } from "./claude-code.ts";
export type { CodexConfig } from "./codex.ts";
export type { BubConfig } from "./bub.ts";

export type {
  Agent,
  AgentContext,
  AgentCapabilities,
  AgentSession,
  AgentTracing,
  Telemetry,
  SandboxAgentDef,
  RemoteAgentDef,
  McpServer,
} from "../types.ts";
