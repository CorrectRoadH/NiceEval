import type { AttemptRef, ExperimentAttemptRowData, ExperimentEvalRowData, ExperimentTableData } from "../types.ts";
import type { ReportLocale } from "../locale.ts";
import { formatDurationMs, formatPlainNumber, formatUSD } from "../format.ts";

export interface ExperimentTableWebProps {
  data: ExperimentTableData;
  attemptHref?: (ref: AttemptRef) => string;
  filter?: boolean;
  locale?: ReportLocale;
  className?: string;
}

const copy = {
  en: { experiment: "Experiment", model: "Model", agent: "Agent", duration: "Avg duration", pass: "Pass rate", tokens: "Tokens", cost: "Est. cost", result: "Result", evals: "Evals", evalUnit: "evals", attempts: "attempts", passed: "passed", failed: "failed", errored: "errored", skipped: "skipped", runs: "Runs", totalTime: "Total time", totalCost: "Total cost", ran: "Ran", evaluations: "Evaluation attempts", status: "Status", eval: "Eval", reason: "Reason", time: "Time", run: "Run", raw: "Raw sample result", rawNote: "debug JSON; defaults to a failed or errored result", default: "default", none: "none" },
  "zh-CN": { experiment: "实验", model: "模型", agent: "Agent", duration: "平均耗时", pass: "成功率", tokens: "Tokens", cost: "预估成本", result: "结果", evals: "Eval 数", evalUnit: "个 eval", attempts: "次尝试", passed: "通过", failed: "失败", errored: "错误", skipped: "跳过", runs: "运行次数", totalTime: "总耗时", totalCost: "总成本", ran: "运行", evaluations: "各 Eval", status: "状态", eval: "Eval", reason: "原因", time: "耗时", run: "轮次", raw: "原始样例结果", rawNote: "调试 JSON，默认选择第一条错误/失败", default: "默认", none: "无" },
} as const;

function fmtDate(value: string | undefined, locale: ReportLocale): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function fmtTokens(value: number | null): string {
  return value === null ? "—" : `${formatPlainNumber(value)} tokens`;
}

function fmtCost(value: number | null): string { return value === null ? "—" : formatUSD(value); }
function tone(value: number | null): string { return value === null ? "" : value >= .8 ? " nre-good" : value >= .5 ? " nre-warn" : " nre-bad"; }

function Verdict({ verdict, locale }: { verdict: ExperimentEvalRowData["verdict"]; locale: ReportLocale }) {
  const t = copy[locale];
  return <span className={`nre-experiment-verdict nre-${verdict}`}>{t[verdict]}</span>;
}

function reasonOf(row: { reason?: string; scoreSummary?: string }): string { return row.reason ?? row.scoreSummary ?? "—"; }

function AttemptRow({ row, evalKey, locale, attemptHref }: { row: ExperimentAttemptRowData; evalKey: string; locale: ReportLocale; attemptHref?: (ref: AttemptRef) => string }) {
  const body = <>
    <span><Verdict verdict={row.verdict} locale={locale} /></span>
    <span className="nre-experiment-eval-id">{evalKey}</span>
    <span className="nre-experiment-reason" title={reasonOf(row)}>{reasonOf(row)}</span>
    <span className="nre-num">{formatDurationMs(row.durationMs)}{row.startedAt ? <small>{fmtDate(row.startedAt, locale)}</small> : null}</span>
    <span className="nre-num">{fmtTokens(row.tokens)}</span>
    <span className="nre-num">{fmtCost(row.totalCostUSD)}</span>
    <span className="nre-num">#{row.attempt + 1}</span>
  </>;
  const href = row.hasEvidence && attemptHref ? attemptHref(row.ref) : undefined;
  return href ? <a className="nre-experiment-eval-row nre-experiment-attempt" href={href}>{body}</a> : <div className="nre-experiment-eval-row nre-experiment-attempt">{body}</div>;
}

function EvalRow({ row, locale, attemptHref }: { row: ExperimentEvalRowData; locale: ReportLocale; attemptHref?: (ref: AttemptRef) => string }) {
  const content = <>
    <span><Verdict verdict={row.verdict} locale={locale} /></span>
    <span className="nre-experiment-eval-id">{row.key}</span>
    <span className="nre-experiment-reason" title={reasonOf(row)}>{reasonOf(row)}</span>
    <span className="nre-num">{formatDurationMs(row.durationMs)}</span>
    <span className="nre-num">{fmtTokens(row.tokens)}</span>
    <span className="nre-num">{fmtCost(row.totalCostUSD)}</span>
    <span className="nre-num nre-run-ratio">{row.passedRuns}/{row.runs}</span>
  </>;
  if (row.attempts.length <= 1) {
    const href = attemptHref ? attemptHref(row.representativeRef) : undefined;
    return href ? <a className="nre-experiment-eval-row" href={href}>{content}</a> : <div className="nre-experiment-eval-row">{content}</div>;
  }
  return <details className="nre-experiment-eval-group">
    <summary className="nre-experiment-eval-row">{content}</summary>
    <div className="nre-experiment-attempts">{row.attempts.map((attempt) => <AttemptRow key={attempt.attempt} row={attempt} evalKey={row.key} locale={locale} attemptHref={attemptHref} />)}</div>
  </details>;
}

function configEntries(row: ExperimentTableData["rows"][number], t: typeof copy.en | typeof copy["zh-CN"]): [string, string][] {
  const c = row.config;
  return [
    [t.experiment, row.experimentId], [t.model, row.model ?? t.default], [t.agent, row.agent],
    ["runs", String(c.runs)], ...(c.earlyExit === undefined ? [] : [["earlyExit", String(c.earlyExit)] as [string,string]]),
    ...(c.sandbox ? [["sandbox", c.sandbox] as [string,string]] : []), ...(c.timeoutMs ? [["timeout", formatDurationMs(c.timeoutMs)] as [string,string]] : []),
    ...(c.budget === undefined ? [] : [["budget", formatUSD(c.budget)] as [string,string]]),
    ["flags", c.flags && Object.keys(c.flags).length ? Object.entries(c.flags).map(([k,v]) => `${k}=${String(v)}`).join(", ") : t.none],
  ];
}

export function ExperimentTable({ data, attemptHref, filter = false, locale = "en", className }: ExperimentTableWebProps) {
  const t = copy[locale];
  const table = <div className="nre-experiment-table">
    <div className="nre-experiment-head">{[t.experiment,t.model,t.agent,t.duration,t.pass,t.tokens,t.cost,t.result].map((label, index) => <button type="button" data-nre-experiment-sort={index} className={index === 4 ? "nre-sort-desc" : undefined} key={label}>{label}</button>)}</div>
    {data.rows.map((row) => <details className="nre-experiment-entry" key={row.key}>
      <summary className="nre-experiment-summary">
        <span className="nre-experiment-name" data-sort-value={row.label}><b>{row.label}</b><small>{row.summary.evals} {locale === "zh-CN" ? t.evalUnit : `eval${row.summary.evals === 1 ? "" : "s"}`}{row.summary.attempts > row.summary.evals ? ` · ${row.summary.attempts} ${t.attempts}` : ""} · {fmtDate(row.lastRunAt, locale)}</small></span>
        <span data-sort-value={row.model ?? ""}>{row.model ?? t.default}</span><span data-sort-value={row.agent}>{row.agent}</span>
        <span className="nre-num" data-sort-value={row.summary.duration.value ?? ""}>{row.summary.duration.display}</span>
        <span className={`nre-num${tone(row.summary.passRate.value)}`} data-sort-value={row.summary.passRate.value ?? ""}>{row.summary.passRate.display}</span>
        <span className="nre-num" data-sort-value={row.summary.tokens.value ?? ""}>{row.summary.tokens.display}</span><span className="nre-num" data-sort-value={row.summary.cost.value ?? ""}>{row.summary.cost.display}</span>
        <span data-sort-value={row.summary.verdicts.passed}><span className="nre-experiment-pill">{(["passed","failed","errored","skipped"] as const).filter(k => row.summary.verdicts[k]).map(k => `${row.summary.verdicts[k]} ${t[k]}`).join(" / ") || "—"}</span></span>
      </summary>
      <div className="nre-experiment-detail">
        <div className="nre-experiment-config">{configEntries(row, t).map(([label,value]) => <span className="nre-experiment-chip" key={label}><span>{label}</span><b>{value}</b></span>)}</div>
        <div className="nre-experiment-kpis">
          {[[t.evals,row.summary.evals,""],[t.passed,row.summary.verdicts.passed,"nre-good"],[t.failed,row.summary.verdicts.failed,row.summary.verdicts.failed ? "nre-bad":""],[t.errored,row.summary.verdicts.errored,row.summary.verdicts.errored ? "nre-warn":""],...(row.summary.attempts > row.summary.evals ? [[t.runs,row.summary.attempts,""] as [string, number, string]] : []),[t.totalTime,formatDurationMs(row.summary.durationMs),""],[t.totalCost,fmtCost(row.summary.totalCostUSD),""],[t.ran,fmtDate(row.lastRunAt,locale),""]].map(([label,value,cls]) => <div className="nre-experiment-kpi" key={String(label)}><span>{label}</span><b className={String(cls)}>{value}</b></div>)}
        </div>
        <h3>{t.evaluations}</h3>
        <div className="nre-experiment-evals">
          <div className="nre-experiment-eval-head"><span>{t.status}</span><span>{t.eval}</span><span>{t.reason}</span><span>{t.time}</span><span>{t.tokens}</span><span>{t.cost}</span><span>{t.run}</span></div>
          {row.evals.map((evalRow) => <EvalRow key={evalRow.key} row={evalRow} locale={locale} attemptHref={attemptHref} />)}
        </div>
        {row.rawSample !== undefined ? <details className="nre-experiment-raw"><summary>{t.raw} <span>{t.rawNote}</span></summary><pre>{JSON.stringify(row.rawSample,null,2)}</pre></details> : null}
      </div>
    </details>)}
  </div>;
  if (!filter) return <div className={["nre", className].filter(Boolean).join(" ")}>{table}</div>;
  return <div className={["nre", "nre-experiment-table-wrap", className].filter(Boolean).join(" ")}>
    <input className="nre-filter" data-nre-experiment-filter="" type="search" placeholder={locale === "zh-CN" ? "筛选实验…" : "Filter experiments…"} />
    {table}
  </div>;
}
