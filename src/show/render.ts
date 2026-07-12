// show 的文本渲染:单 eval 详情、--history 时间轴、三个证据切面(transcript / trace / diff)。
// 输出形态照 docs-site/zh/guides/viewing-results.mdx 的示例块;长内容一律截断,
// 但截断永远如实标注剩余数量和原始 artifact 路径 —— 输出对上下文窗口友好,事实源留在盘上。
// 全部纯函数(时间经 now 显式传入),证据数据由调用方 await 好了递进来。

import { join, relative } from "node:path";
import type { AssertionResult, DiffData, EvalResult, Verdict } from "../types.ts";
import type { AttemptEvidence, AttemptEvidenceCapabilities, AttemptHandle, Selection, Snapshot } from "../results/index.ts";
import type { AnnotatedSourceLine } from "../results/index.ts";
import type { ExecutionNode } from "../o11y/execution-tree.ts";
import { foldEvalVerdict } from "../shared/verdict.ts";
import { attemptCostUSD } from "../report/metrics.ts";
import { formatDurationMs, formatMetricValue, formatPlainNumber, formatUSD } from "../report/format.ts";
import { indentBlock, padDisplay, renderAlignedRows, wrapDisplay } from "../report/text/layout.ts";
import type { EvalHistoryRow, ExperimentHistoryRow } from "./compose.ts";

const MISSING = "—";

// ───────────────────────── 时间与小件 ─────────────────────────

/** 判定时间的相对标注("just now" / "41s ago" / "2h ago");未来时刻按 just now 兜底。 */
export function relativeAgo(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 10_000) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 120) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** 时间轴行的时刻:ISO 截到分钟,冒号换 -(与 run 目录名的清洗一致)。 */
export function timelineStamp(iso: string): string {
  return iso.slice(0, 16).replace(/:/g, "-");
}

function verdictMark(verdict: Verdict): string {
  if (verdict === "passed") return "✓";
  if (verdict === "skipped") return "-";
  return "✗";
}

function attemptsLabel(n: number): string {
  return `${n} ${n === 1 ? "attempt" : "attempts"}`;
}

/** attempt 的展示序号:落盘 attempt 从 0 计,人看 1 计( artifact 目录后缀 __2 = attempt 3)。 */
export function displayAttemptNumber(attempt: AttemptHandle): number {
  return attempt.result.attempt + 1;
}

/**
 * attempt artifact 目录的展示路径:尽量给相对 cwd 的短路径,出了 cwd 给绝对路径。
 * 本快照跑出的条目:artifact 与 result.json 同目录,= `<snapshot.dir>/<ref.attempt>`。
 * 携带条目(--resume 合入):落盘的 artifactBase 相对结果根(= snapshot.dir 的上两级,
 * 即 `<experiment-dir>/<snapshot-dir>` 的上一层),指向原快照的 attempt 目录。
 */
export function attemptArtifactsPath(attempt: AttemptHandle, cwd: string): string {
  const r = attempt.result;
  const abs = r.artifactBase
    ? join(attempt.snapshot.dir, "..", "..", r.artifactBase)
    : join(attempt.snapshot.dir, attempt.ref.attempt);
  const rel = relative(cwd, abs);
  return rel.startsWith("..") ? abs : rel;
}

// ───────────────────────── attempt 挑选 ─────────────────────────

/** Selection 内某道题的全部 attempt(合成 Selection 里每实验只剩最新判定)。 */
export function attemptsOfEval(snapshots: Snapshot[], evalId: string): AttemptHandle[] {
  const out: AttemptHandle[] = [];
  for (const snapshot of snapshots) {
    const ev = snapshot.evals.find((e) => e.id === evalId);
    if (ev) out.push(...ev.attempts);
  }
  return out;
}

/**
 * 详情块 / eval-id 前缀证据切面默认挑最新一次失败的 attempt;没有失败挑最新一次。
 * 精确选某一次 attempt 走 `@<locator>`(`resolveLocator`),不再有数字 `--attempt`——
 * --experiment 已在 Selection 合成时收窄。
 */
export function pickDetailAttempt(attempts: AttemptHandle[]): AttemptHandle | undefined {
  if (attempts.length === 0) return undefined;
  const byTime = [...attempts].sort((a, b) =>
    (a.result.startedAt ?? "").localeCompare(b.result.startedAt ?? "") || a.result.attempt - b.result.attempt,
  );
  const failing = byTime.filter((a) => a.result.verdict === "failed" || a.result.verdict === "errored");
  return failing.at(-1) ?? byTime.at(-1);
}

// ───────────────────────── 单 eval 详情 ─────────────────────────

function scoreText(score: number): string {
  return formatPlainNumber(Math.round(score * 100) / 100);
}

/** 断言行:✓/✗ + severity + name;gate 失败带 detail,soft 恒带 score/1(失败再补 detail)。 */
export function assertionLine(a: AssertionResult): string {
  const head = `${a.passed ? "✓" : "✗"} ${a.severity} ${a.name}`;
  if (a.severity === "soft") {
    const detail = !a.passed && a.detail ? `: ${a.detail}` : "";
    return `${head} — ${scoreText(a.score)}/1${detail}`;
  }
  if (!a.passed) return a.detail ? `${head} — ${a.detail}` : `${head} — score ${scoreText(a.score)}`;
  return head;
}

/** 详情块头部:`attempt 3 · compare/codex-gpt-5.4 · failed · 41s · 12.3k tokens · $0.04`。 */
export function attemptHeader(attempt: AttemptHandle): string {
  const r = attempt.result;
  const parts = [
    `attempt ${displayAttemptNumber(attempt)}`,
    attempt.experimentId,
    r.verdict,
    formatDurationMs(r.durationMs),
  ];
  if (r.usage) parts.push(`${formatMetricValue(r.usage.inputTokens + r.usage.outputTokens)} tokens`);
  const cost = attemptCostUSD(r);
  if (cost !== null) parts.push(formatUSD(cost));
  return parts.join(" · ");
}

// ───────────────────────── AttemptEvidence 共用 ─────────────────────────
// evalSourceText / executionText / attemptOverviewText(--eval / --execution / 默认全景)
// 与 evalDetailText 的紧凑索引列共用的小件:locator 头、capability 字母、失败原因、
// 断言计票摘要。三个证据 renderer 与全景面都只消费同一份 AttemptEvidence,不各自读
// artifact 或重新判定 capability(loadAttemptEvidence 已经算好)。

/** `--eval` / `--execution` / 全景块的头行:`@<locator> · <evalId> · <experimentId> · <verdict>`。 */
export function attemptEvidenceHeader(evidence: AttemptEvidence): string {
  return [evidence.locator, evidence.identity.evalId, evidence.identity.experimentId, evidence.result.verdict].join(" · ");
}

/** capability 位 → 展示字母,只列为 true 的位;全部为 false 时返回空串(不打空 `[]`)。 */
export function capabilityLetters(capabilities: AttemptEvidenceCapabilities): string {
  const letters: string[] = [];
  if (capabilities.eval) letters.push("E");
  if (capabilities.execution) letters.push("X");
  if (capabilities.timing) letters.push("⏱");
  if (capabilities.diff) letters.push("D");
  return letters.length > 0 ? `[${letters.join(",")}]` : "";
}

/**
 * 紧凑多 attempt 索引(裸 `niceeval show`、单 eval 多 experiment 行、evidence flag 撞多个
 * eval 时的消歧提示)用的廉价 capability 估算:只读瘦身 `EvalResult` 字段(`hasSources` /
 * `hasEvents` / `hasTrace`),不为了点亮一个字母去读 artifact —— 与
 * `report/compute.ts::attemptRow` 的 `hasEvidence` 同一个「只认瘦身字段」的口径(它同样只用
 * `hasEvents` / `hasTrace`,同样不读 diff.json)。`diff` 位没有对应的瘦身字段(不像
 * events/trace/sources,写入面从不给 diff 算一个 has* 布尔),而 diff.json 可达上百 MB,
 * 不该为了这一个字母在渲染路径上打开它(见 docs/reports.md「可达百 MB 的 diff 永远不该在
 * 渲染路径上被读」)——因此这里恒报 `false`;只有 `loadAttemptEvidence()` real 出的
 * capabilities(单 attempt 路径,如 `@<locator>` 全景)才知道真实答案。
 */
export function cheapCapabilities(result: EvalResult): AttemptEvidenceCapabilities {
  return {
    eval: result.hasSources === true,
    execution: result.hasEvents === true,
    timing: result.hasEvents === true && result.hasTrace === true,
    diff: false,
  };
}

/**
 * 一次 attempt 未通过的判定原因,单行、不含 detail——供紧凑索引行使用。precedence 与
 * `report/compute.ts::reasonFor` 同一条规则(error → skipReason → 未通过的 gate 断言,
 * soft 永不进入),但格式更短(`gate <name>`,不带 `: <detail>`——detail 留给
 * `--eval`/单 eval 详情块的完整断言明细),这里独立实现而不是导入 report/ 的函数:
 * report 包正被并行重写(见 plan/attempt-evidence-feedback-loop.md),show 的紧凑索引不应
 * 依赖它的内部实现细节。
 */
export function verdictReasonLine(result: EvalResult): string | undefined {
  if (result.error !== undefined) return result.error;
  if (result.skipReason !== undefined) return result.skipReason;
  const gates = result.assertions.filter((a) => !a.passed && a.severity === "gate");
  if (gates.length === 0) return undefined;
  return gates.map((a) => `gate ${a.name}`).join(", ");
}

/** 紧凑多 attempt 索引的一行:`✗ weather/brooklyn  @7K2M9Q[E,X,⏱]  gate calledTool(...)`。 */
export function attemptIndexLine(opts: {
  evalId: string;
  verdict: Verdict;
  locator: string | undefined;
  capabilities: AttemptEvidenceCapabilities;
  reason?: string;
}): string {
  const loc = opts.locator ? `${opts.locator}${capabilityLetters(opts.capabilities)}` : MISSING;
  const parts = [`${verdictMark(opts.verdict)} ${opts.evalId}`, loc];
  if (opts.reason) parts.push(opts.reason);
  return parts.join("  ");
}

/**
 * 断言计票摘要,`--eval` 与全景面共用:`assertions: 1 passed · 1 gate failed · 1 soft below
 * target`。直接读 `EvalResult.assertions`(恒可用的瘦身字段)而不是
 * `AnnotatedEvalSource.summary`——两者对同一批断言算出的计票恒等(`AnnotatedEvalSource` 正是
 * 用这同一个数组喂 `buildAnnotatedEvalSource` 的),但 `evalSource` 可能是 `null`
 * (未捕获源码),读 `result.assertions` 让这条摘要不因缺源码而跟着消失。
 */
export function assertionSummaryLine(assertions: AssertionResult[]): string {
  const passed = assertions.filter((a) => a.passed).length;
  const gateFailed = assertions.filter((a) => !a.passed && a.severity === "gate").length;
  const softBelow = assertions.filter((a) => !a.passed && a.severity === "soft").length;
  const parts: string[] = [];
  if (passed > 0) parts.push(`${passed} passed`);
  if (gateFailed > 0) parts.push(`${gateFailed} gate failed`);
  if (softBelow > 0) parts.push(`${softBelow} soft below target`);
  return `assertions: ${parts.length > 0 ? parts.join(" · ") : "(none)"}`;
}

export interface EvalDetailOptions {
  evalId: string;
  snapshots: Snapshot[];
  /** 详情块展示的 attempt(pickDetailAttempt 的产物);无 attempt 时省略详情块。 */
  detail?: AttemptHandle;
  cwd: string;
  now: number;
  width: number;
}

/** `niceeval show <eval id>`:各 experiment 的判定行 + 默认 attempt 的断言明细。 */
export function evalDetailText(opts: EvalDetailOptions): string {
  const { evalId, snapshots, detail, cwd, now, width } = opts;
  const blocks: string[] = [];

  const description = snapshots
    .flatMap((s) => s.evals.filter((e) => e.id === evalId))
    .flatMap((e) => e.attempts)
    .map((a) => a.result.description)
    .find((d) => d !== undefined);
  blocks.push(description ? `${evalId} — ${description}` : evalId);

  // 每 experiment 一行:折叠判定、attempt 数、最新 attempt 的耗时、总成本、判定时间、
  // 代表 attempt 的紧凑索引(locator + capability 字母 + 失败原因)——agent 从这张榜单
  // 就能直接摘到一个 `@<locator>` 下钻,不必先跑一遍 `--eval`/`--execution` 才知道选谁。
  const rows: string[][] = [];
  for (const snapshot of snapshots) {
    const ev = snapshot.evals.find((e) => e.id === evalId);
    if (!ev || ev.attempts.length === 0) continue;
    const verdict = foldEvalVerdict(ev.attempts.map((a) => a.result));
    const latest = ev.attempts.reduce((a, b) => (b.result.attempt >= a.result.attempt ? b : a));
    let cost: number | null = null;
    for (const attempt of ev.attempts) {
      const c = attemptCostUSD(attempt.result);
      if (c !== null) cost = (cost ?? 0) + c;
    }
    const rep = pickDetailAttempt(ev.attempts);
    const locatorCell = rep?.locator ? `${rep.locator}${capabilityLetters(cheapCapabilities(rep.result))}` : MISSING;
    const reasonCell = rep ? (verdictReasonLine(rep.result) ?? "") : "";
    rows.push([
      snapshot.experimentId,
      `${verdictMark(verdict)} ${verdict}`,
      attemptsLabel(ev.attempts.length),
      formatDurationMs(latest.result.durationMs),
      cost === null ? MISSING : formatUSD(cost),
      `(${relativeAgo(latest.result.startedAt ?? snapshot.startedAt, now)})`,
      locatorCell,
      reasonCell,
    ]);
  }
  if (rows.length > 0) blocks.push(renderAlignedRows(rows));

  if (detail) {
    const lines: string[] = [attemptHeader(detail)];
    for (const a of detail.result.assertions) {
      lines.push(indentBlock(wrapDisplay(assertionLine(a), width - 2).join("\n"), "  "));
    }
    if (detail.result.error !== undefined) {
      lines.push(indentBlock(wrapDisplay(`error: ${detail.result.error}`, width - 2).join("\n"), "  "));
    }
    if (detail.result.skipReason !== undefined) {
      lines.push(indentBlock(wrapDisplay(`skipped: ${detail.result.skipReason}`, width - 2).join("\n"), "  "));
    }
    blocks.push(lines.join("\n"));

    const tail: string[] = [];
    const artifacts = attemptArtifactsPath(detail, cwd);
    if ( artifacts) tail.push(`artifacts: ${artifacts}/`);
    if (detail.locator) tail.push(`attempt locator: ${detail.locator}`);
    tail.push(
      detail.locator
        ? `next: niceeval show ${detail.locator} [--eval|--execution|--diff]`
        : `next: niceeval show ${evalId} [--eval|--execution|--diff]`,
    );
    blocks.push(tail.join("\n"));
  }

  return blocks.join("\n\n");
}

// ───────────────────────── --history ─────────────────────────

/** 单 eval 时间轴:`compare/codex-gpt-5.4 · 5 runs · passed 2/5` + 每次真实执行一行。 */
export function evalHistoryText(opts: {
  experimentId: string;
  /** 多 eval 前缀时块头带上 eval id;单 eval 与 mdx 示例一致不带。 */
  evalId?: string;
  rows: EvalHistoryRow[];
}): string {
  const { experimentId, evalId, rows } = opts;
  const passed = rows.filter((r) => r.verdict === "passed").length;
  const head = [
    ...(evalId ? [evalId] : []),
    experimentId,
    `${rows.length} ${rows.length === 1 ? "run" : "runs"}`,
    `passed ${passed}/${rows.length}`,
  ].join(" · ");
  if (rows.length === 0) return head;
  const table = renderAlignedRows(
    rows.map((r) => [
      timelineStamp(r.startedAt),
      `${verdictMark(r.verdict)} ${r.verdict}`,
      attemptsLabel(r.attempts),
      r.costUSD === null ? MISSING : formatUSD(r.costUSD),
      r.failedAssertion ?? (r.error ? `error: ${r.error}` : ""),
    ]),
  );
  return `${head}\n\n${indentBlock(table, "  ")}`;
}

/** 实验级 per-run 通过率序列(裸 `show --history`)。 */
export function experimentHistoryText(experimentId: string, rows: ExperimentHistoryRow[]): string {
  const head = `${experimentId} · ${rows.length} ${rows.length === 1 ? "run" : "runs"}`;
  if (rows.length === 0) return head;
  const table = renderAlignedRows(
    rows.map((r) => [
      timelineStamp(r.startedAt),
      `${r.passedEvals}/${r.totalEvals} passed`,
      r.costUSD === null ? MISSING : formatUSD(r.costUSD),
    ]),
  );
  return `${head}\n\n${indentBlock(table, "  ")}`;
}

// ───────────────────────── 截断预算(--eval / --execution / 全景共用) ─────────────────────────

const MAX_EVENTS = 80;
const MAX_TEXT = 600;

function clip(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (+${text.length - max} more chars)`;
}

function jsonPreview(value: unknown, max = 200): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "";
  } catch {
    text = String(value);
  }
  return clip(text, max);
}

// ───────────────────────── 证据切面:--eval(Eval 源码标注) ─────────────────────────

const MAX_SOURCE_LINES = 400;

/** gate 失败 / soft 恒带分——与 assertionLine 的严重度口径一致,但不带断言 name(源码行本身就是名字)。 */
function evalAssertionDetailLine(a: AssertionResult): string | undefined {
  if (a.severity === "soft") {
    const detail = !a.passed && a.detail ? ` · ${a.detail}` : "";
    return `soft · ${scoreText(a.score)}/1${detail}`;
  }
  if (!a.passed) return `gate${a.detail ? ` · ${a.detail}` : ""}`;
  return undefined;
}

function evalSourceLineText(line: AnnotatedSourceLine, gutterWidth: number, width: number): string[] {
  const anyFailed = line.assertions.some((a) => !a.passed);
  const glyph = line.assertions.length === 0 ? " " : anyFailed ? "✗" : "✓";
  const marginWidth = gutterWidth + 2; // 行号列 + glyph + 分隔空格
  const prefix = `${padDisplay(String(line.line), gutterWidth)}${glyph} `;
  const wrapped = wrapDisplay(line.text, Math.max(20, width - marginWidth));
  const out = wrapped.map((text, i) => (i === 0 ? prefix + text : " ".repeat(marginWidth) + text));
  const margin = " ".repeat(marginWidth);
  for (const a of line.assertions) {
    const detail = evalAssertionDetailLine(a);
    if (detail === undefined) continue;
    for (const wrapped2 of wrapDisplay(detail, Math.max(20, width - marginWidth))) out.push(margin + wrapped2);
  }
  return out;
}

/**
 * `--eval`:运行时保存的 Eval 源码,gate/soft 断言标回源码行,外加 unmapped 断言(永不丢弃)
 * 与断言计票摘要。`evidence.evalSource === null` 时如实说明源码未捕获,不伪造空文档。
 */
export function evalSourceText(
  evidence: AttemptEvidence,
  opts: { header: string; artifactPath?: string; width: number },
): string {
  const { header, artifactPath, width } = opts;
  const source = evidence.evalSource;
  const artifact = artifactPath ? join(artifactPath, "sources.json") : undefined;
  if (!source) {
    return `${header}\n\n(eval source unavailable for this attempt${artifact ? ` · expected: ${artifact}` : ""})`;
  }

  const blocks: string[] = [header, `eval source: ${source.sourcePath} · sha256:${source.sourceSha256.slice(0, 8)}…`];

  const gutterWidth = String(source.lines.length).length;
  const shownLines = source.lines.slice(0, MAX_SOURCE_LINES);
  const lineLines = shownLines.flatMap((line) => evalSourceLineText(line, gutterWidth, width));
  if (source.lines.length > shownLines.length) {
    lineLines.push(`(${source.lines.length - shownLines.length} more lines not shown)`);
  }
  blocks.push(lineLines.join("\n"));

  if (source.unmapped.length > 0) {
    const unmappedLines = source.unmapped.map((a) => indentBlock(wrapDisplay(assertionLine(a), width - 2).join("\n"), "  "));
    blocks.push(
      [`unmapped assertions (${source.unmapped.length}, no source location):`, ...unmappedLines].join("\n"),
    );
  }

  blocks.push(assertionSummaryLine(evidence.result.assertions));
  if (artifact) blocks.push(`full eval source: ${artifact}`);
  return blocks.join("\n\n");
}

// ───────────────────────── 证据切面:--execution(标准事件流 + OTel enrichment) ─────────────────────────

const EXEC_LABEL_PAD = 12;
const EXEC_TIME_PAD = 6;

function relSeconds(ms: number, originMs: number): string {
  return `${((ms - originMs) / 1000).toFixed(1)}s`;
}

/** 一个 ExecutionNode 的一行(或折行后多行);时间列只在整棵树 timingAvailable 时出现。 */
function execBody(
  time: string | undefined,
  label: string,
  text: string,
  duration: string | undefined,
  width: number,
  timingAvailable: boolean,
): string[] {
  const timeCol = timingAvailable ? padDisplay(time ?? "", EXEC_TIME_PAD) + " " : "";
  const marginWidth = timeCol.length + EXEC_LABEL_PAD;
  const wrapped = wrapDisplay(clip(text), Math.max(20, width - marginWidth));
  return wrapped.map((line, i) => {
    if (i !== 0) return " ".repeat(marginWidth) + line;
    const head = timeCol + padDisplay(label, EXEC_LABEL_PAD) + line;
    return duration ? `${head}  ${duration}` : head;
  });
}

/**
 * action / subagent 节点渲染成两行(call + result)——节点模型把 call+result 合并成一个
 * ExecutionNode(按 callId),但分两行读更符合「先看调用、再看结果」的阅读顺序,
 * 与 docs-site/zh/guides/agent-feedback-loop.mdx 的示例一致。
 */
function executionNodeLines(node: ExecutionNode, originMs: number, timingAvailable: boolean, width: number): string[] {
  const time = node.kind !== "telemetry" && node.span ? relSeconds(node.span.startMs, originMs) : undefined;
  const duration = node.kind !== "telemetry" && node.span ? formatDurationMs(node.span.endMs - node.span.startMs) : undefined;
  const resultTime = node.kind !== "telemetry" && node.span ? relSeconds(node.span.endMs, originMs) : undefined;

  switch (node.kind) {
    case "message":
      return execBody(time, node.role, node.text, duration, width, timingAvailable);
    case "thinking":
      return execBody(time, "thinking", clip(node.text, 200), duration, width, timingAvailable);
    case "skill.loaded":
      return execBody(time, "skill load", node.skill, duration, width, timingAvailable);
    case "action": {
      const status = node.status !== "completed" ? ` (${node.status})` : "";
      const call = execBody(time, "tool call", `${node.name} ${jsonPreview(node.input)}`, duration, width, timingAvailable);
      const result = execBody(
        resultTime,
        "tool result",
        `${node.output !== undefined ? jsonPreview(node.output) : "(no result)"}${status}`,
        undefined,
        width,
        timingAvailable,
      );
      return [...call, ...result];
    }
    case "subagent": {
      const status = node.status !== "completed" ? ` (${node.status})` : "";
      const call = execBody(time, "subagent", node.name, duration, width, timingAvailable);
      if (node.output === undefined && node.status === "pending") return call;
      const result = execBody(
        resultTime,
        "subagent result",
        `${node.output !== undefined ? jsonPreview(node.output) : "(no result)"}${status}`,
        undefined,
        width,
        timingAvailable,
      );
      return [...call, ...result];
    }
    case "input.requested":
      return execBody(
        time,
        "input",
        node.request.prompt ?? node.request.display ?? "(input requested)",
        duration,
        width,
        timingAvailable,
      );
    case "compaction":
      return execBody(time, "compaction", node.reason ?? "context compacted", duration, width, timingAvailable);
    case "error":
      return execBody(time, "error", node.message, duration, width, timingAvailable);
    case "telemetry":
      return execBody(
        relSeconds(node.span.startMs, originMs),
        "telemetry",
        node.span.name || node.span.kind || "span",
        formatDurationMs(node.span.endMs - node.span.startMs),
        width,
        true,
      );
  }
}

/**
 * `--execution`:标准事件流骨架(message / thinking / skill load / tool call+result / subagent /
 * input.requested / compaction / error),有 OTel 时同一节点补相对时间与耗时;没有 OTel 时
 * 节点、顺序与内容不变,只去掉时间列,并在结尾如实标 timing unavailable
 * (ExecutionTree 的契约:骨架不因时间有无而变形,见 o11y/execution-tree.ts 头注)。
 */
export function executionText(
  evidence: AttemptEvidence,
  opts: { header: string; artifactPath?: string; width: number },
): string {
  const { header, artifactPath, width } = opts;
  const tree = evidence.execution;
  const eventsSource = artifactPath ? join(artifactPath, "events.json") : undefined;
  if (!tree) {
    return `${header}\n\n(no events recorded for this attempt${eventsSource ? ` · expected: ${eventsSource}` : ""})`;
  }

  const timingAvailable = tree.timingAvailable;
  const spanStarts = tree.nodes.flatMap((n) => (n.span ? [n.span.startMs] : []));
  const originMs = spanStarts.length > 0 ? Math.min(...spanStarts) : 0;

  const shown = tree.nodes.slice(0, MAX_EVENTS);
  const lines = shown.flatMap((node) => executionNodeLines(node, originMs, timingAvailable, width));

  const tail: string[] = [];
  if (timingAvailable) {
    const skillLoads = tree.nodes.filter((n) => n.kind === "skill.loaded").length;
    const toolCalls = tree.nodes.filter((n) => n.kind === "action").length;
    const aiMessages = tree.nodes.filter((n) => n.kind === "message" && n.role === "assistant").length;
    tail.push(
      [
        `total ${formatDurationMs(evidence.result.durationMs)}`,
        `${skillLoads} skill ${skillLoads === 1 ? "load" : "loads"}`,
        `${toolCalls} tool ${toolCalls === 1 ? "call" : "calls"}`,
        `${aiMessages} AI ${aiMessages === 1 ? "message" : "messages"}`,
        ...(tree.nodes.length > shown.length ? [`${tree.nodes.length - shown.length} more events not shown`] : []),
      ].join(" · "),
    );
  } else {
    tail.push(
      [
        "timing unavailable · OTel trace was not collected",
        ...(tree.nodes.length > shown.length ? [`${tree.nodes.length - shown.length} more events not shown`] : []),
      ].join(" · "),
    );
  }
  if (eventsSource) tail.push(`full events: ${eventsSource}`);
  if (timingAvailable && artifactPath) tail.push(`full OTel trace: ${join(artifactPath, "trace.json")}`);

  return `${header}\n\n${lines.join("\n")}\n\n${tail.join("\n")}`;
}

// ───────────────────────── 默认全景:AttemptEvidence 紧凑总览 ─────────────────────────

const MAX_OVERVIEW_DIFF_NAMES = 5;

function overviewDiffLine(diff: DiffData): string {
  const names = [
    ...Object.keys(diff.generatedFiles).sort().map((p) => `M ${p}`),
    ...[...diff.deletedFiles].sort().map((p) => `D ${p}`),
  ];
  const shown = names.slice(0, MAX_OVERVIEW_DIFF_NAMES);
  const more = names.length > shown.length ? ` · +${names.length - shown.length} more` : "";
  return `changes: ${names.length} ${names.length === 1 ? "file" : "files"} changed · ${shown.join(", ")}${more}`;
}

/**
 * `niceeval show @<locator>` 不带证据 flag 时的默认面:紧凑全景,只给摘要——Eval 断言计票、
 * 执行事件计数、可选 OTel 时间指示、工作区 diff 摘要,不复现 `--eval` 的完整源码、
 * `--execution` 的完整事件流或 `--diff` 的完整文件列表(那些内容各自的证据 flag 才给)。
 */
export function attemptOverviewText(
  evidence: AttemptEvidence,
  opts: { header: string; artifactPath?: string; width: number },
): string {
  const { header, artifactPath } = opts;
  const r = evidence.result;

  const metaParts = [`snapshot ${evidence.identity.snapshotStartedAt}`, `attempt ${evidence.identity.attempt + 1}`, formatDurationMs(r.durationMs)];
  if (r.usage) metaParts.push(`${formatMetricValue(r.usage.inputTokens + r.usage.outputTokens)} tokens`);
  const cost = attemptCostUSD(r);
  if (cost !== null) metaParts.push(formatUSD(cost));

  const blocks: string[] = [[header, metaParts.join(" · ")].join("\n")];

  blocks.push(
    [
      assertionSummaryLine(r.assertions),
      evidence.evalSource
        ? `eval source: ${evidence.evalSource.sourcePath} · sha256:${evidence.evalSource.sourceSha256.slice(0, 8)}…`
        : "eval source: unavailable (not captured for this attempt)",
    ].join("\n"),
  );

  if (evidence.execution) {
    const nodes = evidence.execution.nodes;
    const skillLoads = nodes.filter((n) => n.kind === "skill.loaded").length;
    const toolCalls = nodes.filter((n) => n.kind === "action").length;
    const aiMessages = nodes.filter((n) => n.kind === "message" && n.role === "assistant").length;
    const execLines = [`execution: ${nodes.length} events · ${skillLoads} skill loads · ${toolCalls} tool calls · ${aiMessages} AI messages`];
    if (evidence.capabilities.timing) {
      execLines.push("timing: OTel spans recorded for this attempt — see --execution for per-step timing.");
    }
    blocks.push(execLines.join("\n"));
  } else {
    blocks.push("execution: unavailable (no events recorded for this attempt)");
  }

  if (evidence.diff && evidence.capabilities.diff) {
    blocks.push(overviewDiffLine(evidence.diff));
  } else if (evidence.diff) {
    blocks.push("changes: diff unavailable · this attempt did not produce workspace file changes");
  } else {
    blocks.push("changes: diff unavailable · no workspace diff was recorded for this attempt");
  }

  const capWords = [
    evidence.capabilities.eval ? "eval source [E]" : undefined,
    evidence.capabilities.execution ? "execution [X]" : undefined,
    evidence.capabilities.timing ? "OTel timing [⏱]" : undefined,
    evidence.capabilities.diff ? "diff [D]" : undefined,
  ].filter((x): x is string => x !== undefined);

  const tail: string[] = [`evidence: ${capWords.length > 0 ? capWords.join(" · ") : "(none captured for this attempt)"}`];
  if (artifactPath) tail.push(`artifacts: ${artifactPath}/`);
  tail.push(`next: niceeval show ${evidence.locator} [--eval|--execution|--diff]`);
  blocks.push(tail.join("\n"));

  return blocks.join("\n\n");
}

// ───────────────────────── 证据切面:diff ─────────────────────────

const MAX_DIFF_LINES = 200;

export function diffText(opts: {
  header: string;
  diff: DiffData | null;
  artifactPath?: string;
  /** --diff=<路径>:看单个文件的完整内容。 */
  file?: string;
}): string {
  const { header, diff, artifactPath, file } = opts;
  const source = artifactPath ? join( artifactPath, "diff.json") : undefined;
  if (!diff) {
    return `${header}\n\n(no diff recorded for this attempt${source ? ` · expected: ${source}` : ""})`;
  }

  if (file !== undefined) {
    const content = diff.generatedFiles[file];
    if (content === undefined) {
      if (diff.deletedFiles.includes(file)) return `${header}\n\nD ${file} (deleted by the agent)`;
      const known = [...Object.keys(diff.generatedFiles), ...diff.deletedFiles];
      return `${header}\n\nFile "${file}" is not in this attempt's diff. Files: ${known.join(", ") || "(none)"}`;
    }
    const lines = content.split("\n");
    const shown = lines.slice(0, MAX_DIFF_LINES);
    const footer = [
      `${lines.length} ${lines.length === 1 ? "line" : "lines"}`,
      ...(lines.length > shown.length ? [`${lines.length - shown.length} more lines not shown`] : []),
      ...(source ? [`full diff: ${source}`] : []),
    ].join(" · ");
    return `${header}\n\n${file}\n${shown.join("\n")}\n\n(${footer})`;
  }

  const generated = Object.entries(diff.generatedFiles).sort(([a], [b]) => a.localeCompare(b));
  const deleted = [...diff.deletedFiles].sort();
  if (generated.length === 0 && deleted.length === 0) {
    return `${header}\n\n(no file changes recorded${source ? ` · full diff: ${source}` : ""})`;
  }
  // 落盘的 diff 只有改后全文(git name-status + readFile),没有基线:
  // 行数是文件现大小,不硬编 +/- 增删行;A/M 无从区分,统一 M(created or modified)。
  const rows = [
    ...generated.map(([path, content]) => {
      const lines = content.split("\n").length;
      return ["M", path, `${lines} ${lines === 1 ? "line" : "lines"}`];
    }),
    ...deleted.map((path) => ["D", path, "(deleted)"]),
  ];
  const footer = [
    `${rows.length} ${rows.length === 1 ? "file" : "files"}`,
    ...(source ? [`full diff: ${source}`] : []),
  ].join(" · ");
  return `${header}\n\n${renderAlignedRows(rows)}\n\n(${footer})`;
}
