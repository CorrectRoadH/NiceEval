// Human profile renderer(见 docs/feature/experiments/cli.md「人在终端里怎么用」)。
//
// 两个变体,由 `io.stderr.isTTY` 在构造时选一次(profile 是消费者模型,TTY 只是传输能力 ——
// 显式 `--output human` 在非 TTY 下仍是 human,只是退化成纯追加文案,不悄悄变成 agent 语义):
//
// - TTY:动态 dashboard(命令/elapsed/守恒计数/cost/active slots)覆盖重画,永久事件走
//   clear → append → redraw(coordinator 保证顺序,这里只需正确实现三个钩子)。
// - 非 TTY:零 ANSI 的追加流 —— 只有 start(plan 永久事件天然充当)、永久事件、以及连续 30
//   秒无永久事件时的一条 heartbeat;不追踪 active slot,不重画。
//
// 两个变体共用同一份「永久事件 → 文本行」的纯函数(renderDurableLines 及其子函数),保证
// 完成页/失败行/诊断行的实际文案在两种模式下完全一致,只有「要不要用 ANSI 维护一块动态区域」
// 不同 —— 不是两套平行的文案实现。
//
// 完成页(summary/saved 两个永久事件)不再调用 `./reporters/table.ts` 的 `renderRunReport()`
// 大表:失败优先摘要 + locator + show/view 下一步 + 折叠后的快照路径,完整对比留给
// `niceeval show` / `niceeval view`(见 docs 的「人看的结束反馈」)。

import { t } from "../../i18n/index.ts";
import { verdictSymbol } from "../reporters/shared.ts";
import { formatCost } from "../../shared/format.ts";
import { assertionSummaryLines } from "../../scoring/display.ts";
import { encodeAttemptKey } from "../types.ts";
import {
  panelCapabilityOf as panelCapability,
  panelContentWidth,
  renderPanel,
  type PanelMode,
  type PanelRow,
} from "../../report/model/panel.ts";
import { stringWidth } from "../../report/model/text-layout.ts";
import type {
  ActiveAttempt,
  ActiveExperimentHook,
  AttemptKey,
  ExperimentHookName,
  LifecyclePhase,
  DurableFeedbackEvent,
  RunFeedbackPlan,
  RunFeedbackState,
} from "../types.ts";
import type { FeedbackRenderer } from "./renderer.ts";
import type { FeedbackIO } from "./io.ts";

/** live/结束面板的传输能力(docs/feature/reports/library/layout.md「区域框」):是 TTY 且
 *  没有要求朴素输出(`NO_COLOR`)时才画框——`io.env` 而不是直接读 `process.env`,保持
 *  profile renderer 可用假 IO 确定性测试。 */
function panelCapabilityForFeedback(io: FeedbackIO): { mode: PanelMode; width: number } {
  return panelCapability({ isTTY: io.stderr.isTTY, noColor: io.env.NO_COLOR, width: io.stderr.columns });
}

/** 失败/errored 默认展开上限(见 cli.md「'立即追加'也必须有上限」表:human 前 10 条)。 */
const HUMAN_FAILURE_CAP = 10;
/** 快照结果路径超过这个数量才折叠成「前 N 个 + … 还有 M 个」,不是 cli.md 的强制数字 ——
 *  docs 的两个完成页示例(FAILED / PASSED)对同样 5 条路径给了两种不同的排版,契约本身只要求
 *  「多时折叠,不逐行刷满几十个」,这里选一个单一、可预测的算法同时满足两边。 */
const RESULTS_PATH_CAP = 3;
/** 非 TTY human 退化流的空闲 heartbeat 阈值(见 cli.md「什么动态更新,什么逐条追加」表)。 */
const NON_TTY_HEARTBEAT_IDLE_MS = 30_000;
/** dashboard 高度预留:避免最后一行触发终端自动滚动(与 live.ts 旧实现的 `rows - 2` 同一动机,
 *  这里只需要给「下一帧」留出一行余地,不需要额外的表头/尾行预留)。 */
const DASHBOARD_ROW_RESERVE = 1;

export interface HumanRendererOptions {
  io: FeedbackIO;
  /** dashboard 首行的命令名(如 "niceeval exp compare");CLI 层按 argv 拼好传入 —— renderer
   *  不解析 argv,不重新发明「这次跑的是什么命令」。 */
  command: string;
}

/** 按 `io.stderr.isTTY` 派发:构造时选一次,运行期不再切换。 */
export function createHumanRenderer(options: HumanRendererOptions): FeedbackRenderer {
  const { io, command } = options;
  return io.stderr.isTTY ? createDashboardRenderer(io, command) : createPlainRenderer(io);
}

// ───────────────────────── 共享:永久事件 → 文本行(纯函数,两种模式同一份文案) ─────────────────────────

/** 一条永久事件 → 待写入的整行文本(不含结尾换行,调用方统一 join("\n") + "\n")。
 *  空数组表示这个事件类型在 human 下没有可见内容(目前没有这种情形,保留以防未来扩展)。
 *  `panel` 是面板的传输能力(见 `panelCapabilityOf`)——只有面板体裁(plan/summary/saved)
 *  消费它;流事件(failure/diagnostic/…)不画框,不需要这份能力。 */
export function renderDurableLines(
  event: DurableFeedbackEvent,
  state: RunFeedbackState,
  panel: { mode: PanelMode; width: number },
): string[] {
  switch (event.type) {
    case "plan":
      return buildPlanLines(event.plan, panel);
    case "failure": {
      // 立即追加也要遵守展开上限(见 cli.md「'立即追加'也必须有上限,防止失败风暴重新淹没
      // 输出」)。reducer 已经把这一条计入 state.failures(emit() 先 reduce 再入队),所以
      // freshFailureCount 就是「本次新发生且算上这一条」的累计数；plan 静态注入的复用失败
      // 不消耗流式上限。越过上限
      // 的第一条给一次 suppressed 提示(让人立刻知道开始折叠了);再往后的每一条都静默 ——
      // 不然「追加一次」会变成每条失败都重复一遍「还剩多少条」,完成页的 FAILURES 区块才是
      // 最终准确总数的权威来源。
      const count = state.freshFailureCount;
      if (count <= HUMAN_FAILURE_CAP) return [buildFailureLine(event)];
      if (count === HUMAN_FAILURE_CAP + 1) {
        return [t("feedback.human.suppressedFailures", { count: 1 })];
      }
      return [];
    }
    case "diagnostic":
      return buildDiagnosticLines(event, state);
    case "budget-exhausted":
      return [
        `! ${t("feedback.human.budgetExhausted", {
          experimentId: event.experimentId,
          spent: event.spent.toFixed(2),
          unstarted: event.unstarted,
        })}`,
      ];
    case "interrupted":
      return [t("runner.interrupted").trimEnd()];
    case "reporter-error":
      return [t("runner.reporterDiagnostic", { stage: event.reporter, message: event.message }).trimEnd()];
    case "kept":
      // 留存授予单条不即时打印;run 摘要后由 buildSummaryLines 汇总成 Kept sandboxes 块
      // (见 docs/feature/sandbox/cli.md「run 收尾输出」)。
      return [];
    case "experiment-hook": {
      // 只服务非 TTY 退化流(TTY dashboard 的 appendDurable 对这个事件直接返回,运行级行
      // 由 state.experimentHooks 驱动,成功钩子不进 scrollback,见 cli.md「实验级钩子的显示」)。
      const label = experimentHookLabel(event.hook);
      const duration = event.durationMs !== undefined ? ` (${formatElapsed(event.durationMs)})` : "";
      const recoverySuffix = event.recovery ? ` (recovery)` : "";
      if (event.status === "started") return [`${label} · ${event.experimentId}${recoverySuffix}`];
      const statusWord =
        event.status === "done" ? t("feedback.human.hookDone") : t("feedback.human.hookFailed");
      return [`${label} ${statusWord} · ${event.experimentId}${duration}`];
    }
    case "summary":
      return buildSummaryLines(event, state, panel);
    case "saved":
      return buildSavedLines(event, state, panel);
    default: {
      // 穷尽性检查:新增 DurableFeedbackEvent 变体时这里编译期报错提醒补上对应分支。
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** 把一条永久事件的渲染行写到正确的流(见 docs/feature/experiments/cli.md「输出流和落盘
 *  节奏」的 stream 边界表:human 的 `stdout` 只留给"最终摘要与结果路径",也就是 "summary" /
 *  "saved" 这两个事件;计划、失败、诊断等其它永久事件与 dashboard 本身都在 `stderr`)。
 *  TTY/非 TTY 两个变体共用这一份判断,不各自重复一遍分支。 */
function writeDurable(io: FeedbackIO, event: DurableFeedbackEvent, state: RunFeedbackState): void {
  const lines = renderDurableLines(event, state, panelCapabilityForFeedback(io));
  if (lines.length === 0) return;
  const text = `${lines.join("\n")}\n`;
  if (event.type === "summary" || event.type === "saved") io.stdout.write(text);
  else io.stderr.write(text);
}

/** `PLAN` 面板(docs/feature/experiments/cli.md「运行中的 live 面板」):规模一行 + 复用一行
 *  (全新派发时省略),经 panel.ts 画框——面板体裁全仓只有一个渲染件,这里不手拼 `╭─`。 */
function buildPlanLines(plan: RunFeedbackPlan, panel: { mode: PanelMode; width: number }): string[] {
  const rows: PanelRow[] = [
    {
      kind: "line",
      text: t("feedback.human.plan", {
        total: plan.shape.totalAttempts,
        evals: plan.shape.evals,
        configs: plan.shape.configs,
        concurrency: plan.shape.maxConcurrency,
      }),
    },
  ];
  if (plan.reused > 0) {
    rows.push({
      kind: "line",
      text: t("feedback.human.reuse", {
        reused: plan.reused,
        total: plan.shape.totalAttempts,
        toRun: Math.max(0, plan.shape.totalAttempts - plan.reused),
      }),
    });
  }
  return renderPanel({ title: t("feedback.human.planHeader"), rows, width: panel.width, mode: panel.mode });
}

function buildFailureLine(event: DurableFeedbackEvent & { type: "failure" }): string {
  const phaseSuffix = event.phase ? ` · ${phaseLabel(event.phase)}` : "";
  const summary = event.assertion ? assertionSummaryLines(event.assertion) : [event.reason];
  const body = summary.map((line, index) => `${index === 0 ? "    " : "        "}${line}`).join("\n");
  return `${verdictSymbol(event.verdict)} ${event.locator} ${event.identity.evalId} [${event.who}]${phaseSuffix}\n${body}`;
}

function buildDiagnosticLines(event: DurableFeedbackEvent & { type: "diagnostic" }, state: RunFeedbackState): string[] {
  // count 从 state.diagnostics 读(reducer 已经按 key 去重累加),不在这里自己维护第二份计数。
  const count = state.diagnostics.find((d) => d.key === event.key)?.count ?? 1;
  const sym = event.severity === "error" ? "✗" : "!";
  const suffix = count > 1 ? ` (${count} attempts)` : "";
  return [`${sym} ${event.key}${suffix}`, `  ${event.message}`];
}

/** 结束结论(`FAILED`/`PASSED`/…)+ `FAILURES`(有失败才出现)+ `KEPT SANDBOXES`(有留存才
 *  出现)——三个各自独立的面板,用空行分隔(docs/feature/experiments/cli.md「人看的结束反馈」、
 *  docs/feature/sandbox/cli.md「run 收尾输出」)。`NEXT` 面板不在这里:它要等 `saved` 事件
 *  的落盘路径,见 `buildSavedLines`。 */
function buildSummaryLines(
  event: DurableFeedbackEvent & { type: "summary" },
  state: RunFeedbackState,
  panel: { mode: PanelMode; width: number },
): string[] {
  const { summary, completion } = event;
  const fullReuse = state.total > 0 && state.total === state.reused;
  // required reporter(默认 artifacts、显式 --json/--junit)写失败必须让这行判红——它不是
  // CompletionStatus 的第四个值(那个枚举只有 complete/incomplete/interrupted 三态),但和
  // ci.ts 的 resultStatusWord() 同一个判断顺序:不能让人看到一句会被误读成"全绿"的 PASSED,
  // 而进程实际以非零退出(见 computeCiExitCode 对 reporterErrors 的同一条判断)。
  const verdictWord =
    completion.status === "interrupted"
      ? t("feedback.human.resultInterrupted")
      : completion.status === "incomplete"
        ? t("feedback.human.resultIncomplete")
        : summary.failed > 0 || summary.errored > 0 || completion.reporterErrors.some((e) => e.required)
          ? t("feedback.human.resultFailed")
          : t("feedback.human.resultPassed");

  const summaryRows: PanelRow[] = [
    {
      kind: "line",
      text: t(fullReuse ? "feedback.human.summaryAllReusedLine" : "feedback.human.summaryLine", {
        passed: summary.passed,
        failed: summary.failed,
        errored: summary.errored,
        reused: state.reused,
      }),
    },
    { kind: "line", text: formatSummaryCostLine(state) },
  ];
  const blocks: string[][] = [
    renderPanel({ title: verdictWord, meta: formatElapsed(summary.durationMs), rows: summaryRows, width: panel.width, mode: panel.mode }),
  ];

  // 全通过时(state.failures 为空)不留空 FAILURES 面板。fresh 失败来自 durable event，carry
  // 失败由 plan 静态注入；reducer 把两者按 locator 收进同一清单，这里不从 InvocationSummary 再造。
  if (state.failures.length > 0) {
    const shown = state.failures.slice(0, HUMAN_FAILURE_CAP);
    const failureRows: PanelRow[] = [
      { kind: "line", text: shown.map((f) => buildFailureLine({ ...f, type: "failure" })).join("\n\n") },
    ];
    if (state.failures.length > HUMAN_FAILURE_CAP) {
      failureRows.push({
        kind: "line",
        text: t("feedback.human.suppressedFailures", { count: state.failures.length - HUMAN_FAILURE_CAP }),
      });
    }
    const meta =
      state.failures.length > HUMAN_FAILURE_CAP
        ? `${state.failures.length} total · showing ${HUMAN_FAILURE_CAP}`
        : undefined;
    blocks.push(
      renderPanel({ title: t("feedback.human.failuresHeader"), meta, rows: failureRows, width: panel.width, mode: panel.mode }),
    );
  }

  // 留存授予块(--keep-sandbox,见 docs/feature/sandbox/cli.md「run 收尾输出」):
  // 每条给 locator(接 niceeval show)、provider 与实例 id、进入现场的命令,下边框嵌批量清理。
  if (state.kept.length > 0) {
    const keptRows: PanelRow[] = [];
    for (const k of state.kept) {
      keptRows.push({
        kind: "line",
        text: `${k.locator}  ${k.identity.evalId} #${k.identity.attempt}  ${k.verdict}  ${k.provider} · ${k.sandboxId}`,
      });
      keptRows.push({
        kind: "line",
        text: `${" ".repeat(stringWidth(k.locator) + 2)}enter: niceeval sandbox enter ${k.sandboxId.slice(0, 12)}`,
      });
    }
    blocks.push(
      renderPanel({
        title: t("feedback.human.keptSandboxesHeader"),
        meta: `${state.kept.length} kept`,
        footerCommand: "niceeval sandbox stop --all",
        rows: keptRows,
        width: panel.width,
        mode: panel.mode,
      }),
    );
  }

  return blocks.flatMap((block, i) => (i === 0 ? block : ["", ...block]));
}

/** `NEXT` 面板(docs/feature/experiments/cli.md「人看的结束反馈」):下钻命令(只给第一条
 *  失败做示范)+ `Compare:`,再加一条嵌套 `RESULTS` 横隔带出本次落盘的快照路径——两部分
 *  在旧实现里分属两个事件(summary 的下钻命令 / saved 的路径),现在合成同一个面板,
 *  借 `state.failures` 在 `saved` 事件触发时仍然可读(reducer 早已把失败收进 state)。 */
function buildSavedLines(
  event: DurableFeedbackEvent & { type: "saved" },
  state: RunFeedbackState,
  panel: { mode: PanelMode; width: number },
): string[] {
  const rows: PanelRow[] = [];
  const first = state.failures[0];
  if (first) {
    rows.push({ kind: "line", text: t("feedback.human.inspect", { locator: first.locator }) });
    rows.push({ kind: "line", text: t("feedback.human.evalHint", { locator: first.locator }) });
    rows.push({ kind: "line", text: t("feedback.human.trace", { locator: first.locator }) });
    rows.push({ kind: "line", text: t("feedback.human.diffHint", { locator: first.locator }) });
  }
  // 比较命令直接是 `niceeval view`——它读整个结果根,不需要(也不该被)目录路径收窄成
  // 一个 eval 位置参数(那是选择语义,不是报告分组语义);见 docs/feature/experiments/cli.md。
  rows.push({ kind: "line", text: t("feedback.human.compare") });

  const paths = event.paths;
  if (paths.length > 0) {
    rows.push({ kind: "divider", title: t("feedback.human.resultsHeader") });
    for (const p of paths.slice(0, RESULTS_PATH_CAP)) rows.push({ kind: "line", text: p });
    if (paths.length > RESULTS_PATH_CAP) {
      rows.push({ kind: "line", text: t("feedback.human.resultsMore", { count: paths.length - RESULTS_PATH_CAP }) });
    }
  }
  return renderPanel({ title: t("feedback.human.nextHeader"), rows, width: panel.width, mode: panel.mode });
}

/** tok/cost 一行(不含时长——时长已经嵌在面板上边框右侧的 meta 里,不在正文里重复一遍)。 */
function formatSummaryCostLine(state: RunFeedbackState): string {
  const fullReuse = state.total > 0 && state.total === state.reused;
  if (fullReuse) return "0 new tok · $0.00";
  const parts: string[] = [];
  if (state.newTokenCount !== undefined) parts.push(`${formatTokenCount(state.newTokenCount)} new tok`);
  const cost = formatCost(state.estimatedCostUSD);
  if (cost !== "—") parts.push(cost);
  return parts.join(" · ");
}

// ───────────────────────── 共享:纯格式化 helper ─────────────────────────

/** "2m 14s" / "54s" 风格,匹配 cli.md 全部 dashboard/完成页示例;`shared/format.ts` 的
 *  `formatDuration` 是 "2.3m"/"120ms" 风格,服务的是 view/表格场景,不是这里要的格式。 */
export function formatElapsed(ms: number): string {
  const totalS = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** "1.2M tok" / "3.4k" 风格;`table.ts` 的 `formatTokens` 只到 k 档,凑不出 cli.md 完成页
 *  示例里的 "1.2M tok"。 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** LifecyclePhase → Human 展示列的人读投影(见 docs/feature/experiments/cli.md「Attempt 阶段」);
 *  机器面(agent/ci 的 `phase=` 与落盘)保留精确的点分名,收尾段在 Human 侧合并显示为一档。 */
function phaseLabel(phase: LifecyclePhase): string {
  switch (phase) {
    // 实验级两员不会作为 ActiveAttempt.phase 出现(钩子跑的时候没有活跃 attempt),
    // 这里只服务 failure 行的 phase 标注(experiment.setup 失败的合成 errored 结果)。
    case "experiment.setup":
      return t("feedback.phase.experimentSetup");
    case "experiment.teardown":
      return t("feedback.phase.teardown");
    case "sandbox.queue":
      return t("feedback.phase.sandboxQueue");
    case "sandbox.create":
      return t("feedback.phase.sandboxCreate");
    case "sandbox.setup":
      return t("feedback.phase.sandboxSetup");
    case "workspace.baseline":
      return t("feedback.phase.workspaceBaseline");
    case "eval.setup":
      return t("feedback.phase.evalSetup");
    case "agent.setup":
      return t("feedback.phase.agentSetup");
    case "telemetry.configure":
      return t("feedback.phase.telemetryConfigure");
    case "eval.run":
    case "agent.run": // 嵌套成员:Human 展示不切换顶层阶段
      return t("feedback.phase.evalRun");
    case "workspace.diff":
      return t("feedback.phase.workspaceDiff");
    case "scoring.evaluate":
      return t("feedback.phase.scoring");
    case "telemetry.collect":
      return t("feedback.phase.telemetryCollect");
    case "eval.teardown":
    case "agent.teardown":
    case "sandbox.teardown":
    case "sandbox.suspend":
    case "sandbox.stop":
      return t("feedback.phase.teardown");
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

/** 实验级钩子的运行级行标签。`phaseLabel` 把 `experiment.teardown` 与其它收尾段合并成
 *  「cleaning up」一档(那是 attempt failure 行的语境);运行级行没有 attempt 语境,必须
 *  自报家门是哪个实验级钩子,所以这里用独立的两个词。 */
function experimentHookLabel(hook: ExperimentHookName): string {
  return hook === "setup" ? t("feedback.phase.experimentSetup") : t("feedback.phase.experimentTeardown");
}

function formatCounts(state: RunFeedbackState): string {
  const counts = t("feedback.human.counts", {
    total: state.total,
    reused: state.reused,
    running: state.running,
    queued: state.queued,
    completed: state.completed,
  });
  if (state.estimatedCostUSD === undefined || state.estimatedCostUSD <= 0) return counts;
  return `${counts}  ${formatCost(state.estimatedCostUSD)}`;
}

/** 定宽格式化:内容按 `width` 左对齐补空格对齐后面的列;超宽时尾部截断补 `…`(cli.md
 *  「active 行的列序」:身份列「超宽截尾补 `…`」),不是硬切丢字符。`width <= 0` 退化为空串。 */
function padTrunc(s: string, width: number): string {
  if (width <= 0) return "";
  if (s.length <= width) return s.padEnd(width);
  if (width === 1) return "…";
  return `${s.slice(0, width - 1)}…`;
}

// ───────────────────────── TTY:动态 dashboard ─────────────────────────

function createDashboardRenderer(io: FeedbackIO, command: string): FeedbackRenderer {
  // active slot 的稳定顺序:只在这里追加/删除(attempt:start 追加到末尾,
  // attempt:complete/early-exit 删除),phase/detail 变化不改变顺序或成员 ——
  // 可见 attempt 完成前不会因为别的 attempt 更新而换位(checklist「active slots 稳定」)。
  const activeOrder: AttemptKey[] = [];
  // 上一帧写了多少行(供 \x1B[nA 回跳)与上一帧的完整文本(供「同帧不写」判断)。
  let linesDrawn = 0;
  let lastFrameText: string | undefined;
  // 身份两列(evalId/who)本次运行里"实际出现过的最长值"宽度——跨帧单调只放宽不回缩
  // (cli.md「active 行的列序」),存在这个闭包里而不是每次从当前行现算,完成的 attempt
  // 让出 slot 后也不应该让列宽跟着变窄。渲染时还要叠加当帧内容宽算出的封顶(见
  // identityColumnWidths)——封顶随终端 resize 每帧重新从 contentWidth 推导,这里的
  // 「见过的最长值」本身不因为封顶变严就被吃掉,分辨率更宽的下一帧仍能用得上。
  let maxEvalIdWidth = 0;
  let maxWhoWidth = 0;

  /** 身份两列本帧的渲染宽度:观测到的最长值与本帧内容宽算出的 40% / 20% 封顶取较小值。 */
  function identityColumnWidths(contentWidth: number): { evalWidth: number; whoWidth: number } {
    const evalCap = Math.floor(contentWidth * 0.4);
    const whoCap = Math.floor(contentWidth * 0.2);
    return { evalWidth: Math.min(maxEvalIdWidth, evalCap), whoWidth: Math.min(maxWhoWidth, whoCap) };
  }

  /** 上边框标题 = 本次命令、meta = 已运行时长;下边框 footerCommand = 本次新派发的累计成本
   *  (docs/feature/experiments/cli.md「运行中的 live 面板」)。ACTIVE 是嵌套 Section 的
   *  同构体裁——一条贯穿框宽的横隔,不是独立的框;非 boxed(非 TTY 或 NO_COLOR)时
   *  panel.ts 自动降级成无框文本,dashboard 的覆盖重画机制不因此改变,只是重画的内容
   *  换成了无框版本。 */
  function buildFrameLines(state: RunFeedbackState): string[] {
    // 全量复用没有 active attempt，也没有“本次执行中”状态；plan/reuse 与终局摘要已经完整，
    // 不画一块只有 0 running 的 dashboard。
    if (state.total > 0 && state.total === state.reused) return [];
    const capability = panelCapabilityForFeedback(io);
    // live 面板豁免 100 列上限、跟随终端全宽(cli.md「框线体裁」);contentWidth 与下面
    // renderPanel 的 width/capWidth 必须传同一份豁免声明,否则行按这里的宽度排版、框却在
    // renderPanel 内部按另一个宽度钳制,行尾会被框吃掉——这正是 memory/
    // live-dashboard-active-row-width-clamp-mismatch.md 的根因类别。
    const contentWidth = panelContentWidth(capability.width, capability.mode, false);
    const rows: PanelRow[] = [
      {
        kind: "line",
        text: t("feedback.human.counts", {
          total: state.total,
          reused: state.reused,
          running: state.running,
          queued: state.queued,
          completed: state.completed,
        }),
      },
    ];
    // 实验级钩子的运行级行排在 attempt 行前面(见 cli.md「实验级钩子的显示」):它解释了
    // 为什么后面的 attempt 还停在 queued。Map 按插入序迭代,天然满足稳定 slot。
    const hookRows = [...state.experimentHooks.values()];
    if (activeOrder.length > 0 || hookRows.length > 0) {
      rows.push({ kind: "divider", title: t("feedback.human.active") });
      // 固定开销:上边框 + counts 行 + ACTIVE 横隔 + 下边框(boxed);plain 时同样按 4 行估算,
      // 差一两行不影响「窄/矮终端先减 active slots」这条大方向。
      const rowBudget = Math.max(0, io.stderr.rows - 4 - DASHBOARD_ROW_RESERVE);
      const total = hookRows.length + activeOrder.length;
      // 窄/矮终端先减 active slots(减少行数),而不是先压缩单行内容 ——
      // 单行内容的截断在 formatActiveRow 里按 contentWidth 单独处理。
      const showCount = total <= rowBudget ? total : Math.max(0, rowBudget - 1);

      // 先选出本帧真正会显示的行(hook 恒排在前面,与旧实现一致),再统一量测/定宽——
      // 同一帧内所有行必须共用同一套身份列宽度,不能让前面几行按旧宽度格式化、后面
      // 的行又观测到更长的值再推宽,导致同一帧内本该对齐的列错位。
      const shownHooks = hookRows.slice(0, showCount);
      const shownActive: ActiveAttempt[] = [];
      for (const key of activeOrder) {
        if (shownHooks.length + shownActive.length >= showCount) break;
        const active = state.active.get(key);
        if (active) shownActive.push(active);
      }
      // 身份列本次运行"实际出现过的最长值"只放宽不回缩:hook 行的 label 是拼好的一整块
      // 文本,不是 evalId/who 两个独立字段,不单独参与这里的放宽,只复用下面算出的宽度
      // (cli.md「active 行的列序」:「同一套算法」= 复用同一份结果,不是各自维护一份)。
      for (const active of shownActive) {
        maxEvalIdWidth = Math.max(maxEvalIdWidth, active.identity.evalId.length);
        maxWhoWidth = Math.max(maxWhoWidth, active.who.length);
      }
      const { evalWidth, whoWidth } = identityColumnWidths(contentWidth);

      const activeLines: string[] = shownHooks.map((hookRow) =>
        formatExperimentHookRow(hookRow, io, contentWidth, evalWidth, whoWidth),
      );
      for (const active of shownActive) {
        activeLines.push(formatActiveRow(active, io, contentWidth, evalWidth, whoWidth));
      }
      for (const line of activeLines) rows.push({ kind: "line", text: line });
      if (total > showCount) {
        rows.push({ kind: "line", text: t("feedback.human.moreActive", { count: total - showCount }) });
      }
    }
    const footerCommand =
      state.estimatedCostUSD !== undefined && state.estimatedCostUSD > 0 ? formatCost(state.estimatedCostUSD) : undefined;
    return renderPanel({
      title: command,
      meta: formatElapsed(state.elapsedMs),
      footerCommand,
      rows,
      width: capability.width,
      mode: capability.mode,
      capWidth: false,
    });
  }

  function redraw(state: RunFeedbackState): void {
    const lines = buildFrameLines(state);
    const text = lines.join("\n");
    if (text === lastFrameText) return; // 真实内容没变化,不写(checklist「rendered frame 与上一帧相同则不写」)
    if (lines.length === 0) {
      if (linesDrawn > 0) {
        let out = `\x1B[${linesDrawn}A`;
        out += "\x1B[2K\n".repeat(linesDrawn) + `\x1B[${linesDrawn}A`;
        io.stderr.write(out);
      }
      linesDrawn = 0;
      lastFrameText = text;
      return;
    }
    let out = linesDrawn > 0 ? `\x1B[${linesDrawn}A` : "";
    out += lines.map((l) => `\x1B[2K${l}`).join("\n") + "\n";
    // 本帧比上帧短(行完成后折叠、终端拉高)时,清掉下方残留的旧行,与 live.ts 旧实现同一手法。
    const extra = linesDrawn - lines.length;
    if (extra > 0) out += "\x1B[2K\n".repeat(extra) + `\x1B[${extra}A`;
    io.stderr.write(out);
    linesDrawn = lines.length;
    lastFrameText = text;
  }

  return {
    appendDurable(event, state) {
      // 实验级钩子起止在 TTY 下只驱动运行级 active 行(state.experimentHooks 已由 reducer
      // 更新,coordinator 紧接着的 redrawDynamic 会画出来);成功钩子不写 scrollback 永久行
      // (见 cli.md「实验级钩子的显示」)。非 TTY 退化流才逐行追加(见 renderDurableLines)。
      if (event.type === "experiment-hook") return;
      writeDurable(io, event, state);
    },
    activity(text) {
      // 运行级瞬时通知(judge 预检、provider 一次性通知……):coordinator 已按
      // clearDynamic → activity → redrawDynamic 包好顺序,这里只管把这一行落进 scrollback。
      io.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
    },
    clearDynamic() {
      if (linesDrawn === 0) return; // 幂等:coordinator 收尾时会无条件再调一次
      let out = `\x1B[${linesDrawn}A`;
      out += "\x1B[2K\n".repeat(linesDrawn) + `\x1B[${linesDrawn}A`;
      io.stderr.write(out);
      linesDrawn = 0;
      lastFrameText = undefined; // 物理终端已清空,下一帧必须真的重写,不能被「同帧」判断吞掉
    },
    redrawDynamic(state) {
      redraw(state);
    },
    onTick(_event, state) {
      // coordinator 的 tick 周期(默认 250ms = 4fps)已经是重画的硬上限 —— 这里每个 tick 最多
      // 重画一次;elapsed 按整秒渲染进 formatCommandLine,连同「同帧不写」,自然满足
      // 「elapsed 最多每秒变化一次」而不需要单独的节流变量。
      redraw(state);
    },
    onLifecycle(event) {
      if (event.type === "attempt:start") {
        const key = encodeAttemptKey(event.identity);
        if (!activeOrder.includes(key)) activeOrder.push(key);
      } else if (event.type === "attempt:complete" || event.type === "attempt:early-exit") {
        const key = encodeAttemptKey(event.identity);
        const idx = activeOrder.indexOf(key);
        if (idx !== -1) activeOrder.splice(idx, 1);
      }
      // attempt:phase / attempt:progress 不改变 activeOrder 成员;下一次 tick 的 redraw()
      // 会从 state.active 读到最新 phase/detail,不需要在这里强制重画(见 checklist
      // 「真实 state 变化合并渲染」—— 逐条 lifecycle 事件不各自触发一次重画)。
    },
  };
}

/** active 行的身份两列(evalId/who)按调用方传入的 `evalWidth`/`whoWidth` 定宽——这两个数
 *  是 `createDashboardRenderer` 闭包按「本次运行实际出现过的最长值,封顶内容宽 40% / 20%」
 *  算出来再传进来的(见 `identityColumnWidths`),这个函数本身不比例分配、也不知道 `columns`
 *  的其余部分怎么分。elapsed 固定 6 列右对齐;detail 拿到 `sym + 身份两列 + elapsed + 分隔符`
 *  之后剩下的全部宽度——不是某个比例或固定预留,宽终端因此把整段 phase/detail 露出来
 *  (cli.md「active 行的列序」)。 */
function formatActiveRow(
  active: ActiveAttempt,
  io: FeedbackIO,
  columns: number,
  evalWidth: number,
  whoWidth: number,
): string {
  const elapsed = formatElapsed(io.clock.now() - active.phaseStartedAt).padStart(6);
  const sym = "● ";
  const evalCol = padTrunc(active.identity.evalId, evalWidth);
  const whoCol = padTrunc(active.who, whoWidth);
  const prefix = `${sym}${evalCol}  ${whoCol}  ${elapsed}  `;
  const budget = Math.max(0, columns - prefix.length);
  const detail = active.detail ? `${phaseLabel(active.phase)}: ${active.detail}` : phaseLabel(active.phase);
  return prefix + detail.slice(0, budget);
}

/** 实验级钩子的运行级行:与 attempt 行同一套定宽结果,label 跨过 evalId + 两格间隔 + who
 *  两列的合计宽度(不单独维护第三份"最长值"状态——label 是拼好的一整块文本,拆不出
 *  evalId/who 两个独立字段,所以只复用 attempt 行算出的宽度,而不是各自决定),elapsed 列
 *  因此与 attempt 行对齐;detail 来自实验级 `ctx.progress`,没有就只留标签行。 */
function formatExperimentHookRow(
  hook: ActiveExperimentHook,
  io: FeedbackIO,
  columns: number,
  evalWidth: number,
  whoWidth: number,
): string {
  const elapsed = formatElapsed(io.clock.now() - hook.startedAt).padStart(6);
  const sym = "● ";
  const label = padTrunc(
    `${experimentHookLabel(hook.hook)} · ${hook.experimentId}${hook.recovery ? " (recovery)" : ""}`,
    evalWidth + 2 + whoWidth,
  );
  const prefix = `${sym}${label}  ${elapsed}  `;
  const budget = Math.max(0, columns - prefix.length);
  return prefix + (hook.detail ?? "").slice(0, budget);
}

// ───────────────────────── 非 TTY:human 文案的纯追加流 ─────────────────────────

function createPlainRenderer(io: FeedbackIO): FeedbackRenderer {
  // 上一条永久事件的时间戳:heartbeat 只在「连续 30 秒没有永久事件」时才追加一条
  //(见 checklist「显式 human + 非 TTY」),failure/diagnostic 出现后立即重新计时。
  let lastDurableAtMs = 0;
  return {
    appendDurable(event, state) {
      lastDurableAtMs = event.at;
      writeDurable(io, event, state);
    },
    activity(text) {
      // 运行级瞬时通知按永久行追加(非 TTY 没有可覆盖的动态区域),并重置 heartbeat 计时 ——
      // 刚有输出就不需要紧跟一条「还活着」。
      lastDurableAtMs = io.clock.now();
      io.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
    },
    onTick(event, state) {
      if (event.at - lastDurableAtMs < NON_TTY_HEARTBEAT_IDLE_MS) return;
      lastDurableAtMs = event.at;
      io.stderr.write(
        `${t("feedback.human.heartbeat", { elapsed: formatElapsed(state.elapsedMs), counts: formatCounts(state) })}\n`,
      );
    },
    // 没有 clearDynamic/redrawDynamic/onLifecycle:非 TTY 退化流不维护动态区域,
    // 不展示 active attempt 的逐次阶段变化,也不逐次输出 provisioning retry/backoff ——
    // 这些行为由「不实现对应可选钩子」天然满足,不需要在这里写 profile 分支。
  };
}

// ───────────────────────── `--dry`(human profile):稳定预览,不经 coordinator ─────────────────────────

/** 一个 (config, eval) 组合在 `--dry` 预览里的一行;字段形状与 cli.ts 里已有的 dry 数据一一对应,
 *  只是把 `t("cli.dry.row", ...)` 的拼装从 CLI 分支搬进这里 —— dry 预览同样是「展示」,
 *  不该留在 cli.ts(见 docs/feature/experiments/cli.md 与 plan 对「CLI 只负责解析/构造/退出」的
 *  要求)。dry run 不派发 attempt,没有 `RunFeedbackState` 可言,所以这是独立于
 *  `FeedbackRenderer`/coordinator 的纯函数,与 `renderAgentPlanEnvelope`(agent.ts)同一定位。 */
export interface HumanDryPlanRow {
  who: string;
  /** `run.experimentId` 存在时的后缀,如 `" (exp compare/bub-e2b)"`;否则空串。 */
  experimentSuffix: string;
  evalIds: readonly string[];
  runs: number;
}

export interface HumanDryPlanInput {
  /** 去重前的候选 eval 数(= discover 到、按 `--tag` 过滤后的 eval 总数,与 `cli.dry.header`
   *  历来的口径一致 —— 不是「实际会跑」的去重数,那个概念属于真正开跑时的 `RunFeedbackPlan`)。 */
  evals: number;
  configs: number;
  rows: readonly HumanDryPlanRow[];
}

/** 沿用既有 `cli.dry.header`/`cli.dry.row` 文案(见 src/i18n/{en,zh-CN}.ts),逐行列出每个
 *  (config, eval) 组合会匹配到哪些 eval —— 与 CI/agent 的 dry 预览不同,human 不折叠、不设行数
 *  上限:这条路径历来就是给人逐行读的完整清单。 */
export function renderHumanDryPlan(input: HumanDryPlanInput): string {
  const lines = [t("cli.dry.header", { evals: input.evals, configs: input.configs })];
  for (const row of input.rows) {
    lines.push(
      t("cli.dry.row", {
        who: row.who,
        experiment: row.experimentSuffix,
        evals: row.evalIds.join(", ") || t("cli.dry.noMatches"),
        runs: row.runs,
      }),
    );
  }
  return lines.join("");
}
