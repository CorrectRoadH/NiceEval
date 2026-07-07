// runner 域类型:结果 / 汇总 / reporter 契约,eval / experiment / config 定义,
// 以及调度器的编排类型(AgentRun / RunOptions / Attempt)。

import type { Cleanup, LocalizedText, SourceArtifact } from "../shared/types.ts";
import type { O11ySummary, StreamEvent, TraceSpan, Usage } from "../o11y/types.ts";
import type { Agent } from "../agents/types.ts";
import type { Sandbox, SandboxOption } from "../sandbox/types.ts";
import type { AssertionResult, DiffData, JudgeConfig, ResultOutcome } from "../scoring/types.ts";
import type { TestContext } from "../context/types.ts";

// ───────────────────────── 结果 / 报告 ─────────────────────────

export interface ExperimentRunInfo {
  id?: string;
  flags?: Record<string, unknown>;
  runs?: number;
  earlyExit?: boolean;
  sandbox?: string;
  timeoutMs?: number;
  budget?: number;
}

export interface EvalResult {
  id: string;
  description?: string;
  experimentId?: string;
  experiment?: ExperimentRunInfo;
  agent: string;
  model?: string;
  outcome: ResultOutcome;
  fingerprint?: string;
  attempt: number;
  /** 本 attempt 开始的墙钟时刻(ISO);view 按 eval 粒度展示「何时跑的」。 */
  startedAt?: string;
  durationMs: number;
  assertions: AssertionResult[];
  usage?: Usage;
  estimatedCostUSD?: number;
  error?: string;
  skipReason?: string;
  events?: StreamEvent[];
  /** test 引用到的 eval 源码(按 loc 收集),供 view 渲染 github-diff 式代码视图。 */
  sources?: SourceArtifact[];
  o11y?: O11ySummary;
  /** agent 经 OpenTelemetry 导出的运行追踪(有 tracing 能力且收到 span 时)。 */
  trace?: TraceSpan[];
  diff?: DiffData;
  rawTranscript?: string;
  // ── 拆分工件的引用(Artifacts 报告器写 summary.json 时填;view 按需懒加载)──
  /** 本 attempt 工件目录(相对 run 根),下有 events/trace/o11y/diff.json。 */
  artifactsDir?: string;
  /** view 拼好的工件目录(相对 view 输入根,供前端 fetch);loadSummaries 注入。 */
  artifactBase?: string;
  /** 工件目录的绝对路径;loadSummaries 注入,供复制/展示用。 */
  artifactAbsBase?: string;
  hasTrace?: boolean;
  hasEvents?: boolean;
  hasSources?: boolean;
}

/** `summary.json` 的格式标记;把 niceeval 报告和其它工具的同名文件区分开。 */
export const RESULTS_FORMAT = "niceeval.results";
/** 结果格式版本,只在破坏兼容读取时递增;读取器只认相同版本,缺失按 1。见 docs/results-format.md。 */
export const RESULTS_SCHEMA_VERSION = 1;

export interface RunSummary {
  /** 恒为 "niceeval.results";和 schemaVersion、producer 一起构成持久化契约,永不移动或改名。 */
  format?: typeof RESULTS_FORMAT;
  /** 结果格式版本;与读取器不同即视为不兼容,提示用 producer.version 对应的 niceeval 查看。 */
  schemaVersion?: number;
  /** 写这份报告的 niceeval;version 唯一用途是拼 `npx niceeval@<version> view` 提示。 */
  producer?: { name: "niceeval"; version?: string; commit?: string };
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
  agent: string;
  model?: string;
  startedAt: string;
  completedAt: string;
  passed: number;
  /** 断言不通过的数量;不包含 errored。 */
  failed: number;
  skipped: number;
  /** 环境、超时、adapter、agent runtime 等执行错误数量;与 failed 互斥。 */
  errored: number;
  durationMs: number;
  usage?: Usage;
  estimatedCostUSD?: number;
  results: EvalResult[];
  outputDir?: string;
}

/** onRunStart 的运行规模:去重后 eval 数 × 配置(agent×model×flags)数 → 总运行(attempt)数。 */
export interface RunShape {
  /** 去重后实际要跑的 eval 数(= evals.length)。 */
  evals: number;
  /** (agent, model, flags) 配置组合数;compare 多 agent 时 > 1。 */
  configs: number;
  /** 总 attempt 数(evals × configs × runs);逐行输出与汇总计数都按它。 */
  totalRuns: number;
  /** 本次运行实际生效的并发数(flag/env/experiment/config/sandbox 默认值解析后的结果)。 */
  maxConcurrency: number;
}

export interface Reporter {
  onEvent?(event: ReporterEvent): void | Promise<void>;
  onRunStart?(evals: { id: string }[], agent: Agent, shape?: RunShape): void | Promise<void>;
  onEvalComplete?(result: EvalResult): void | Promise<void>;
  onRunComplete?(summary: RunSummary): void | Promise<void>;
}

export type ReporterEvent =
  | { type: "run:start"; evals: { id: string }[]; agent: Agent; shape: RunShape }
  | { type: "eval:start"; eval: { id: string }; agent: Agent; model?: string; attempt: number; experimentId?: string }
  | { type: "eval:complete"; result: EvalResult }
  | { type: "run:earlyExit"; evalId: string; experimentId?: string }
  | { type: "run:budgetExceeded"; budget: number; spent: number }
  | { type: "run:saved"; summary: RunSummary }
  | { type: "run:summary"; summary: RunSummary };

// ───────────────────────── eval / experiment / config 定义 ─────────────────────────

export interface EvalDef {
  /** 路径推导,定义里禁止手写。 */
  id?: string;
  description?: string;
  agent?: string;
  tags?: string[];
  judge?: JudgeConfig;
  reporters?: Reporter[];
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  /**
   * eval 级预置:拿到沙箱(已上传 workspace + git 基线 + 装好依赖前)。
   * 默认命令以非 root 跑(agent 的自然环境);装系统依赖时给 `runCommand` 传 `{ root: true }`
   * (如 `runCommand("apt-get", ["install", …], { root: true })`),跨后端语义一致。
   */
  setup?: (sandbox: Sandbox) => Promise<void | Cleanup> | void | Cleanup;
  test(t: TestContext): Promise<void> | void;
}

/** 内部:发现后带上 id 的 eval。 */
export interface DiscoveredEval extends EvalDef {
  id: string;
  /** 定义文件所在目录(解析相对 workspace 用)。 */
  baseDir: string;
  /** 定义文件绝对路径,用于内容指纹缓存。 */
  sourcePath: string;
}

export interface ExperimentDef {
  id?: string;
  description?: string;
  agent: Agent;
  /** 单个模型(agent 留空时实验决定);省略=用 agent 原生默认。跨模型对比写多个实验文件,别用数组。 */
  model?: string;
  /** 模型推理努力程度(如 "low"/"medium"/"high",取值由具体模型/adapter 决定);省略=用 agent 原生默认。经 ctx.reasoningEffort 透给 adapter 与 eval。 */
  reasoningEffort?: string;
  flags?: Record<string, unknown>;
  runs?: number;
  earlyExit?: boolean;
  evals?: "*" | string[] | ((id: string) => boolean);
  timeoutMs?: number;
  sandbox?: SandboxOption;
  budget?: number;
  maxConcurrency?: number;
}

export interface DiscoveredExperiment extends ExperimentDef {
  id: string;
  group: string;
}

export interface Config {
  /**
   * 项目名,显示在 `niceeval view` 顶部 hero(`<h1>`),省略则回退到通用标题。
   * 可传字符串,或按 locale 提供多语言(如 `{ en: "...", "zh-CN": "..." }`),随 view 语言切换。
   */
  name?: LocalizedText;
  sandbox?: SandboxOption;
  workspace?: string;
  judge?: JudgeConfig;
  reporters?: Reporter[];
  maxConcurrency?: number;
  timeoutMs?: number;
  /**
   * OTLP 接收配置,niceeval 项目内唯一入口(不读 NICEEVAL_OTLP_* 环境变量)。
   * `port` 钉住接收端口(固定端口模式:长驻服务把 OTEL_EXPORTER_OTLP_ENDPOINT 一次性指到
   * http://localhost:<port>/v1/traces,跑多少次 eval 都不用改)。省略 = 每次运行动态分配
   * 临时端口(经 ctx.telemetry 交给 adapter)。代价:固定端口下同机同时只能跑一个 niceeval 进程,
   * 且该端口被别的进程占用时会报错——换一个空闲端口写回这里即可。
   * `host` 是报给 adapter 的接收端 hostname(而非监听地址,监听地址恒为 0.0.0.0):默认
   * "127.0.0.1";docker 沙箱型 tracing 需要 "host.docker.internal" 之类的场景,或配了隧道
   * 的远程接入,在这里覆盖。
   */
  telemetry?: { host?: string; port?: number };
  /**
   * 内置价格表(`o11y/prices.json`)之上的用户覆盖 / 补充,按 model 查(见 Observability
   * · 用量与成本)。key 支持精确 model 名或 `provider/*` 通配(自托管/网关折扣按 provider 批量覆盖);
   * 精确 key 优先于通配。只在没有网关实测成本(`usage.costUSD`)时才会用到——实测优先于估算恒成立。
   */
  pricing?: Record<string, PriceOverride>;
}

/** 每百万 token 的美元单价;省略的桶退回 `inputPerMTok`(cache token 本质也是 input)。 */
export interface PriceOverride {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

// ───────────────────────── 调度编排 ─────────────────────────

/**
 * 进度行 / 日志里标识一个 run 配置的短名。有 experiment 时用其 basename(唯一,
 * 能区分同 agent 同 model 的实验变体,如 xxx 与 xxx--agents-md;与汇总表口径一致);
 * 无 experiment 时退回 agent/model。live display 以它作行聚合 key,两处必须同源。
 */
export function runWho(run: Pick<AgentRun, "agent" | "model" | "experimentId">): string {
  if (run.experimentId) return run.experimentId.split("/").pop()!;
  return run.model ? `${run.agent.name}/${run.model}` : run.agent.name;
}

/** 一个 (agent, model, flags) 的运行配置 —— 由 CLI / 实验展开。 */
export interface AgentRun {
  agent: Agent;
  model?: string;
  reasoningEffort?: string;
  flags: Record<string, unknown>;
  runs: number;
  earlyExit: boolean;
  sandbox?: SandboxOption;
  timeoutMs?: number;
  budget?: number;
  evalFilter: (id: string) => boolean;
  experimentId?: string;
  strict?: boolean;
}

export interface RunOptions {
  config: Config;
  evals: DiscoveredEval[];
  agentRuns: AgentRun[];
  reporters: Reporter[];
  maxConcurrency: number;
  signal?: AbortSignal;
  /** TTY live display 的进度回调;设置后 attempt 的 log 消息路由到它而不是 stderr。 */
  onProgress?: (evalId: string, who: string, msg: string) => void;
  /** 上次运行的结果。outcome === "passed" 的 (experimentId, evalId) 组合跳过重跑,结果直接合入本次汇总。 */
  priorResults?: EvalResult[];
  /**
   * 非沙箱 tracing agent 的 run 级共享 OTLP 接收池(runEvals 创建并回收;
   * 每个 agent 一个 receiver,attempt 之间共享 —— 被测应用是长驻进程,端点不能随 attempt 换)。
   */
  otelPool?: import("../o11y/otlp/turn-otel.ts").OtelReceiverPool;
}

/** 调度器内部的一次尝试:eval × run × 第几轮。 */
export interface Attempt {
  evalDef: DiscoveredEval;
  run: AgentRun;
  attempt: number;
  /** agent+model+evalId,用于早停。 */
  key: string;
  fingerprint: string;
}
