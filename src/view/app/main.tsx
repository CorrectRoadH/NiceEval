import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Copy } from "lucide-react";
import { detectLocale, makeTranslator, persistLocale, setDocumentLocale } from "./i18n.ts";
import type { MessageKey } from "./i18n.ts";
import type {
  ActionCalledEvent,
  ActionResultEvent,
  Assertion,
  CodeSource,
  Indexed,
  IndexedTurns,
  Locale,
  ObjectRecord,
  Outcome,
  SortKey,
  SortState,
  SourceTurn,
  Span,
  Tab,
  TranscriptEvent,
  ToolResultEvent,
  ViewData,
  ViewJson,
  ViewResult,
  ViewRow,
  ViewUsage,
} from "./types.ts";
import "../styles.css";

type T = (key: MessageKey) => string;
type OpenModal = (result: ViewResult) => void;
type ArtifactLoadState =
  | { sources: CodeSource[] | null; events: TranscriptEvent[] | null; status: "loading" | "ready" | "none" };
type RowRun = ViewResult & { rowLabel: string; rowAgent: string; rowModel?: string };
type LazyArtifactType = "trace" | "transcript";
type ToolBlockCall = { tool?: string; name: string; input: ViewJson };

const navItems: { id: Tab; label: MessageKey }[] = [
  { id: "experiments", label: "nav.experiments" },
  { id: "runs", label: "nav.runs" },
  { id: "traces", label: "nav.traces" },
];

const initialData: ViewData = window.__FASTEVAL_VIEW_DATA__ ?? {
  rows: [],
  lastRun: "No runs yet",
  passRate: "0%",
  resultCount: "0",
  duration: "0ms",
  cost: "$0",
};

function resultFromUrl(rows: ViewRow[]): ViewResult | null {
  const p = new URLSearchParams(location.search);
  const id = p.get("modal");
  if (!id) return null;
  const exp = p.get("exp");
  const attempt = parseInt(p.get("a") ?? "0", 10);
  for (const row of rows) {
    for (const result of row.results ?? []) {
      if (result.id === id && (!exp || result.experimentId === exp) && result.attempt === attempt) {
        return result;
      }
    }
  }
  return null;
}

function App({ data }: { data: ViewData }) {
  const rows = data.rows ?? [];
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const t = useMemo(() => makeTranslator(locale), [locale]);
  const [tab, setTab] = useState<Tab>("experiments");
  const [sort, setSort] = useState<SortState>({ key: "passRate", dir: -1 });
  const [query, setQuery] = useState("");
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const [selectedGroup, setSelectedGroup] = useState(() => {
    const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort();
    return groups[0] ?? null;
  });
  const [modalResult, setModalResult] = useState<ViewResult | null>(() => resultFromUrl(rows));

  useEffect(() => {
    setDocumentLocale(locale);
    persistLocale(locale);
  }, [locale]);

  const openModal = useCallback((result: ViewResult) => {
    setModalResult(result);
    const p = new URLSearchParams();
    p.set("modal", result.id);
    if (result.experimentId) p.set("exp", result.experimentId);
    p.set("a", String(result.attempt));
    history.replaceState(null, "", "?" + p.toString());
  }, []);

  const closeModal = useCallback(() => {
    setModalResult(null);
    history.replaceState(null, "", location.pathname);
  }, []);

  const groupMap = useMemo<Map<string, ViewRow[]>>(() => buildGroupMap(rows), [rows]);
  const pool = selectedGroup ? groupMap.get(selectedGroup) ?? [] : rows;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((row: ViewRow) => {
        if (!q) return true;
        return [
          row.label,
          row.group || "",
          row.experimentId || "",
          row.agent,
          row.model || "",
          ...(row.results ?? []).map((r: ViewResult) => r.id),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a: ViewRow, b: ViewRow) => compareRows(a, b, sort.key) * sort.dir);
  }, [pool, query, sort]);

  const setSortKey = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: key === "experiment" || key === "agent" ? 1 : -1 },
    );
  };

  const toggleRow = (key: string) => {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      <header className="topbar">
        <a className="brand" href="https://github.com/CorrectRoadH/fasteval" target="_blank" rel="noreferrer">
          <span className="mark" />
          <span>fasteval</span>
        </a>
        <nav className="nav" aria-label={t("nav.label")}>
          {navItems.map((item) => (
            <button key={item.id} className={`nav-tab${tab === item.id ? " is-active" : ""}`} onClick={() => setTab(item.id)}>
              {t(item.label)}
            </button>
          ))}
        </nav>
        <div className="lang-switch" aria-label="Language">
          {(["en", "zh-CN"] satisfies Locale[]).map((item) => (
            <button
              key={item}
              className={locale === item ? "is-active" : ""}
              type="button"
              onClick={() => setLocale(item)}
              aria-pressed={locale === item}
            >
              {item === "zh-CN" ? "中文" : "EN"}
            </button>
          ))}
        </div>
      </header>
      <main>
        <section className="hero">
          <h1>{t("hero.title")}</h1>
          <div className="meta">
            <span>
              <b>{t("hero.lastRun")}</b> {data.lastRun}
            </span>
          </div>
        </section>

        <section className="summary" aria-label="Run summary">
          <Metric label={t("metric.passRate")} value={data.passRate} />
          <Metric label={t("metric.evalResults")} value={data.resultCount} />
          <Metric label={t("metric.duration")} value={data.duration} />
          <Metric label={t("metric.cost")} value={data.cost} />
        </section>

        {tab === "experiments" && (
          <section id="tab-experiments">
            <div className="section-head">
              <h2>{t("section.experiments")}</h2>
            </div>
            <GroupSelector groupMap={groupMap} selectedGroup={selectedGroup} onSelect={setSelectedGroup} t={t} />
            <div className="section-sub-head">
              <span className="group-detail-label">{selectedGroup ?? ""}</span>
              <div className="controls">
                <input
                  className="search"
                  type="search"
                  placeholder={t("search.experiments")}
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <CopyAllErrors rows={filtered} t={t} />
              </div>
            </div>
            {rows.length ? (
              <ExperimentTable
                rows={filtered}
                sort={sort}
                setSortKey={setSortKey}
                openRows={openRows}
                toggleRow={toggleRow}
                openModal={openModal}
                t={t}
              />
            ) : (
              <div className="empty">
                {t("empty.summary")}
              </div>
            )}
          </section>
        )}

        {tab === "runs" && <RunsView rows={rows} t={t} />}
        {tab === "traces" && <TracesView rows={rows} t={t} />}
      </main>
      {modalResult && <AttemptModal result={modalResult} onClose={closeModal} t={t} />}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function GroupSelector({
  groupMap,
  selectedGroup,
  onSelect,
  t,
}: {
  groupMap: Map<string, ViewRow[]>;
  selectedGroup: string | null;
  onSelect: (group: string) => void;
  t: T;
}) {
  if (!groupMap.size) return <div id="group-selector" className="group-selector" />;
  return (
    <div id="group-selector" className="group-selector">
      {[...groupMap.keys()].sort().map((group) => {
        const groupRows = groupMap.get(group) ?? [];
        const allResults = groupRows.flatMap((r: ViewRow) => r.results ?? []);
        const passed = allResults.filter((r: ViewResult) => outcomeOf(r) === "passed").length;
        const failed = allResults.filter((r: ViewResult) => outcomeOf(r) === "failed").length;
        const errored = allResults.filter((r: ViewResult) => outcomeOf(r) === "errored").length;
        const passRate = allResults.length ? passed / allResults.length : 0;
        const tone = passRate >= 0.8 ? "good" : passRate >= 0.5 ? "warn" : "bad";
        const totalCost = groupRows.reduce((s: number, r: ViewRow) => s + (r.estimatedCostUSD || 0), 0);
        const lastRun = groupRows
          .map((r: ViewRow) => r.lastRunAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1);
        const selected = selectedGroup === group;
        return (
          <div
            key={group}
            className={`group-card${selected ? " is-selected" : ""}`}
            tabIndex={0}
            role="button"
            onClick={() => onSelect(group)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(group);
              }
            }}
          >
            <div className="group-card-name">{group}</div>
            <div className={`group-card-rate ${tone}`}>{formatPercent(passRate)}</div>
            <div className="group-card-meta">
              {groupRows.length} {groupRows.length === 1 ? t("detail.evalResult") : t("detail.evalResults")} · {failed} {t("outcome.failed")}
              {errored ? ` · ${errored} ${t("outcome.errored")}` : ""} · {formatCost(totalCost)}
            </div>
            {lastRun ? <div className="group-card-time">{formatDateTime(lastRun)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function ExperimentTable({
  rows,
  sort,
  setSortKey,
  openRows,
  toggleRow,
  openModal,
  t,
}: {
  rows: ViewRow[];
  sort: SortState;
  setSortKey: (key: SortKey) => void;
  openRows: Set<string>;
  toggleRow: (key: string) => void;
  openModal: OpenModal;
  t: T;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortHeader name={t("table.experiment")} sortKey="experiment" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.model")} sortKey="model" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.agent")} sortKey="agent" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.avgDuration")} sortKey="avgDurationMs" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.successRate")} sortKey="passRate" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.tokens")} sortKey="tokens" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.estCost")} sortKey="cost" sort={sort} onSort={setSortKey} />
            <th>{t("table.outcomes")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: ViewRow) => (
            <React.Fragment key={row.key}>
              <ExperimentRow row={row} open={openRows.has(row.key)} onToggle={() => toggleRow(row.key)} t={t} />
              {openRows.has(row.key) ? <ExperimentDetail row={row} openModal={openModal} t={t} /> : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  name,
  sortKey,
  sort,
  onSort,
}: {
  name: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const sorted = sort.key === sortKey ? (sort.dir === 1 ? "asc" : "desc") : undefined;
  return (
    <th>
      <button data-sorted={sorted} onClick={() => onSort(sortKey)}>
        {name}
      </button>
    </th>
  );
}

function ExperimentRow({ row, open, onToggle, t }: { row: ViewRow; open: boolean; onToggle: () => void; t: T }) {
  const tone = row.passRate >= 0.8 ? "good" : row.passRate >= 0.5 ? "warn" : "bad";
  return (
    <tr
      className={`main-row${open ? " is-open" : ""}`}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <td>
        <ChevronRight className="chev-icon" aria-hidden="true" />
        <span className="name">{row.label}</span>
        <div className="sub">
          {row.runs} {row.runs === 1 ? t("detail.evalResult") : t("detail.evalResults")}
          {row.lastRunAt ? ` · ${formatDateTime(row.lastRunAt)}` : ""}
        </div>
      </td>
      <td>{row.model || t("config.default")}</td>
      <td>{row.agent}</td>
      <td className="num">{formatDuration(row.avgDurationMs)}</td>
      <td className={`num ${tone}`}>{formatPercent(row.passRate)}</td>
      <td className="num">{formatTokens(totalTokens(row.usage))}</td>
      <td className="num">{formatCost(row.estimatedCostUSD)}</td>
      <td>
        <span className="pill">{outcomeSummary(row, t)}</span>
      </td>
    </tr>
  );
}

function ExperimentDetail({ row, openModal, t }: { row: ViewRow; openModal: OpenModal; t: T }) {
  const totalDuration = (row.results ?? []).reduce((sum: number, r: ViewResult) => sum + (r.durationMs || 0), 0);
  const sampleResult =
    row.results?.find((r: ViewResult) => outcomeOf(r) === "errored") ||
    row.results?.find((r: ViewResult) => outcomeOf(r) === "failed") ||
    row.results?.[0] ||
    {};
  const results = [...(row.results ?? [])].sort((a, b) => a.id.localeCompare(b.id) || a.attempt - b.attempt);
  return (
    <tr className="detail-row">
      <td className="detail-cell" colSpan={8}>
        <div className="detail">
          <div className="config-strip">
            {configChips(row, t).map(([label, value]) => (
              <span className="config-chip" key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </span>
            ))}
          </div>
          <div className="detail-kpis">
            <Kpi label={t("detail.attempts")} value={row.runs} />
            <Kpi label={t("detail.passed")} value={row.passed} className="good" />
            <Kpi label={t("detail.failed")} value={row.failed} className={row.failed ? "bad" : ""} />
            <Kpi label={t("detail.errored")} value={row.errored} className={row.errored ? "infra-err" : ""} />
            <Kpi label={t("detail.totalTime")} value={formatDuration(totalDuration)} />
            <Kpi label={t("detail.totalCost")} value={formatCost(row.estimatedCostUSD)} />
            <Kpi label={t("detail.ran")} value={formatDateTime(row.lastRunAt)} title={row.lastRunAt || ""} />
          </div>
          <h3>{t("detail.evaluationAttempts")}</h3>
          <div className="eval-list">
            <div className="eval-grid-head">
              <span>{t("detail.status")}</span>
              <span>{t("detail.eval")}</span>
              <span>{t("detail.reason")}</span>
              <span>{t("detail.time")}</span>
              <span>{t("table.tokens")}</span>
              <span>{t("table.estCost")}</span>
              <span>{t("detail.run")}</span>
            </div>
            {results.map((result) => (
              <Attempt key={`${result.id}-${result.attempt}`} result={result} totalRuns={row.runs} openModal={openModal} t={t} />
            ))}
          </div>
          <details className="raw-details">
            <summary>
              {t("detail.rawSample")} <span className="raw-note">{t("detail.rawNote")}</span>
            </summary>
            <pre>{JSON.stringify(sampleResult, null, 2)}</pre>
          </details>
        </div>
      </td>
    </tr>
  );
}

function Kpi({ label, value, className = "", title }: { label: string; value: ReactNode; className?: string; title?: string }) {
  return (
    <div className="detail-kpi">
      <span>{label}</span>
      <b className={className} title={title}>
        {value}
      </b>
    </div>
  );
}

function Attempt({ result, totalRuns, openModal, t }: { result: ViewResult; totalRuns: number; openModal: OpenModal; t: T }) {
  const outcome = outcomeOf(result);
  const gates = failingAssertions(result);
  const reason = reasonFor(result, gates);
  const allAssertions = result.assertions || [];
  const hasScores = allAssertions.some((a: Assertion) => a.score !== undefined && a.score !== null);
  const hasBody = result.hasEvents || result.hasTrace || hasScores;

  const inlineScores = !reason && outcome === "passed" ? scoresSummary(allAssertions) : "";
  const displayReason = reason || inlineScores;

  const handleOpen = () => openModal(result);

  const cells = (
    <>
      <span className="attempt-status">
        <span className={outcomeClass(outcome)}>{outcomeLabel(outcome, t)}</span>
      </span>
      <span className="eval-id">{result.id}</span>
      <div className="assertions-cell">
        <span
          className={`assertions${hasBody ? " assertions-link" : ""}`}
          title={displayReason || undefined}
          onClick={hasBody ? (e) => { e.stopPropagation(); handleOpen(); } : undefined}
        >
          {displayReason || <span className="reason-empty">—</span>}
        </span>
      </div>
      <span className="num">
        {formatDuration(result.durationMs)}
        {result.startedAt ? <small className="ran-at">{formatClock(result.startedAt)}</small> : null}
      </span>
      <span className="num">{formatTokens(totalTokens(result.usage))}</span>
      <span className="num">{formatCost(result.estimatedCostUSD)}</span>
      <span className="num" title={`attempt ${result.attempt + 1} of ${totalRuns}`}>
        #{result.attempt + 1}
      </span>
    </>
  );

  if (!hasBody) {
    return <div className="eval-item">{cells}</div>;
  }

  return (
    <div
      className="eval-item eval-item-clickable"
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpen(); }
      }}
    >
      {cells}
    </div>
  );
}

function AttemptModal({ result, onClose, t }: { result: ViewResult; onClose: () => void; t: T }) {
  const allAssertions = result.assertions || [];
  const base = result.artifactBase;
  const [data, setData] = useState<ArtifactLoadState>({ sources: null, events: null, status: "loading" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!base) { setData({ sources: null, events: null, status: "none" }); return; }
    let alive = true;
    const grab = (name: string, has?: boolean): Promise<unknown> =>
      has
        ? fetch("/artifact?p=" + encodeURIComponent(`${base}/${name}`))
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null);
    Promise.all([grab("sources.json", result.hasSources), grab("events.json", result.hasEvents)]).then(([sources, events]) => {
      if (alive) setData({ sources: asSources(sources), events: asEvents(events), status: "ready" });
    });
    return () => { alive = false; };
  }, [base, result.hasSources, result.hasEvents]);

  const outcome = outcomeOf(result);
  const hasCode = Boolean(data.sources?.length);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-block">
            <span className={`modal-outcome ${outcomeClass(outcome)}`}>{outcomeLabel(outcome, t)}</span>
            <span className="modal-title">{result.id}</span>
            {result.description ? <span className="modal-desc">{result.description}</span> : null}
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t("action.close")}>x</button>
        </div>
        <div className="modal-body">
          {result.error ? <div className="modal-error">{result.error}</div> : null}
          {data.status === "loading" ? <div className="conv-loading">{t("trace.loading")}</div> : null}
          {hasCode ? (
            <CodeView sources={data.sources ?? []} events={data.events || []} assertions={allAssertions} t={t} />
          ) : data.status !== "loading" ? (
            <NoSourceBody assertions={allAssertions} events={data.events || []} t={t} />
          ) : null}
          {result.hasTrace && base ? <LazyArtifact type="trace" src={`${base}/trace.json`} t={t} /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────── 源码对齐的代码视图(github-diff 式)─────────────────────────
// 拿 sources.json(eval 源码)+ events.json(带 loc 的 send),把每条 send / 断言的运行结果
// 叠回真实源码行:send 行折叠→展开看回复;断言行绿(过)/红(不过),judge 行带分数,展开看 CoT。

function locKey(file: string, line: number): string {
  return `${file}:${line}`;
}

/** events → 按 send 的 loc 聚成「轮」:每轮含 sent 文本 + 后续 thinking/assistant/tool 回复。 */
function indexTurns(events: TranscriptEvent[]): IndexedTurns {
  const byKey = new Map<string, SourceTurn>();
  const noloc: SourceTurn[] = [];
  let cur: SourceTurn | null = null;
  for (const ev of events || []) {
    if (ev.type === "message" && ev.role === "user") {
      cur = { loc: ev.loc, sent: ev.text || "", replies: [] };
      if (ev.loc) byKey.set(locKey(ev.loc.file, ev.loc.line), cur);
      else noloc.push(cur);
    } else if (!cur) {
      continue;
    } else if (ev.type === "message" && ev.role === "assistant") {
      cur.replies.push({ kind: "text", text: ev.text || "" });
    } else if (ev.type === "thinking") {
      cur.replies.push({ kind: "thinking", text: ev.text || "" });
    } else if (ev.type === "action.called") {
      cur.replies.push({ kind: "tool", ev });
    } else if (ev.type === "action.result") {
      const tool = [...cur.replies].reverse().find(
        (r): r is Extract<SourceTurn["replies"][number], { kind: "tool" }> => r.kind === "tool" && r.ev.callId === ev.callId,
      );
      if (tool) tool.result = ev;
    } else if (ev.type === "error") {
      cur.replies.push({ kind: "error", text: ev.message || "error" });
    }
  }
  return { byKey, noloc };
}

/** assertions → 按 loc 聚到行。有 loc 的进 byKey,没 loc 的进 noloc(底部兜底列)。 */
function indexAsserts(assertions: Assertion[]): Indexed<Assertion> {
  const byKey = new Map<string, Assertion[]>();
  const noloc: Assertion[] = [];
  for (const a of assertions || []) {
    if (a.loc) {
      const k = locKey(a.loc.file, a.loc.line);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)?.push(a);
    } else {
      noloc.push(a);
    }
  }
  return { byKey, noloc };
}

function CodeView({ sources, events, assertions, t }: { sources: CodeSource[]; events: TranscriptEvent[]; assertions: Assertion[]; t: T }) {
  const turns = useMemo(() => indexTurns(events), [events]);
  const asserts = useMemo(() => indexAsserts(assertions), [assertions]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((k: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  // 哪些 loc 被源码行覆盖到了;没覆盖到的(读不到源码的文件)放底部兜底。
  const sourceKeys = new Set<string>();
  for (const f of sources) {
    const n = f.content.split("\n").length;
    for (let i = 1; i <= n; i++) sourceKeys.add(locKey(f.path, i));
  }
  const orphanAsserts = [...asserts.byKey.entries()]
    .filter(([k]) => !sourceKeys.has(k))
    .flatMap(([, v]) => v)
    .concat(asserts.noloc);

  return (
    <div className="codeview">
      {sources.map((file) => (
        <CodeFile
          key={file.path}
          file={file}
          turns={turns.byKey}
          asserts={asserts.byKey}
          open={open}
          toggle={toggle}
          t={t}
        />
      ))}
      {orphanAsserts.length ? (
        <div className="code-orphans">
          <div className="code-orphans-head">{t("code.otherAssertions")}</div>
          <AssertDetail asserts={orphanAsserts} t={t} />
        </div>
      ) : null}
    </div>
  );
}

function CodeFile({
  file,
  turns,
  asserts,
  open,
  toggle,
  t,
}: {
  file: CodeSource;
  turns: Map<string, SourceTurn>;
  asserts: Map<string, Assertion[]>;
  open: Set<string>;
  toggle: (key: string) => void;
  t: T;
}) {
  const lines = file.content.replace(/\n$/, "").split("\n");
  return (
    <div className="code-file">
      <div className="code-file-head">{file.path}</div>
      <div className="code-lines">
        {lines.map((text: string, i: number) => {
          const n = i + 1;
          const k = locKey(file.path, n);
          return (
            <CodeLine
              key={n}
              n={n}
              text={text}
              turn={turns.get(k)}
              asserts={asserts.get(k)}
              isOpen={open.has(k)}
              onToggle={() => toggle(k)}
              t={t}
            />
          );
        })}
      </div>
    </div>
  );
}

function CodeLine({
  n,
  text,
  turn,
  asserts,
  isOpen,
  onToggle,
  t,
}: {
  n: number;
  text: string;
  turn?: SourceTurn;
  asserts?: Assertion[];
  isOpen: boolean;
  onToggle: () => void;
  t: T;
}) {
  const hasReply = !!turn;
  const hasAsserts = !!(asserts && asserts.length);
  const status = hasAsserts ? (asserts?.every((a: Assertion) => a.passed) ? "pass" : "fail") : null;
  const clickable = hasReply || hasAsserts;
  const rowCls =
    "code-line" +
    (status ? ` line-${status}` : "") +
    (hasReply && !status ? " line-send" : "") +
    (clickable ? " line-clickable" : "") +
    (isOpen ? " is-open" : "");
  return (
    <>
      <div
        className={rowCls}
        onClick={clickable ? onToggle : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
      >
        <span className="ln">{n}</span>
        <span className="gmark">
          {hasAsserts ? (
            <span className={`gstat ${status === "pass" ? "good" : "bad"}`}>{status === "pass" ? "✓" : "✗"}</span>
          ) : hasReply ? (
            <ChevronRight className={`gchev${isOpen ? " is-open" : ""}`} aria-hidden="true" />
          ) : null}
        </span>
        <code className="ctext">{highlightTs(text)}</code>
        <span className="lbadges">
          {hasAsserts ? asserts?.map((a: Assertion, i: number) => <AssertBadge key={i} a={a} />) : null}
          {hasReply ? (
            <span className="reply-hint">{isOpen ? t("code.hide") : t("code.reply")}</span>
          ) : clickable ? (
            <ChevronRight className={`line-chev${isOpen ? " is-open" : ""}`} aria-hidden="true" />
          ) : null}
        </span>
      </div>
      {isOpen && hasReply && turn ? <ReplyPanel turn={turn} t={t} /> : null}
      {isOpen && hasAsserts && asserts ? <AssertDetail asserts={asserts} t={t} /> : null}
    </>
  );
}

/** 行尾分数徽章:judge / 带阈值的断言显示分数(过绿不过红);纯 gate 断言靠行色 + gutter 勾叉。 */
function AssertBadge({ a }: { a: Assertion }) {
  const showPct = a.threshold !== undefined || (a.score > 0 && a.score < 1);
  if (!showPct) return null;
  return (
    <span className={`abadge ${a.passed ? "good" : "bad"}`}>
      {formatScore(a.score)}
      {a.threshold !== undefined ? <span className="abadge-th">/{formatScore(a.threshold)}</span> : null}
    </span>
  );
}

function ReplyPanel({ turn, t }: { turn: SourceTurn; t: T }) {
  if (!turn.replies.length) return <div className="line-detail reply-empty">{t("code.noReply")}</div>;
  return (
    <div className="line-detail reply-panel">
      {turn.replies.map((r, j) => {
        if (r.kind === "text")
          return (
            <div key={j} className="reply-assistant">
              <span className="reply-role">{t("transcript.assistant")}</span>
              <div className="reply-text">{r.text}</div>
            </div>
          );
        if (r.kind === "thinking")
          return (
            <details key={j} className="reply-think">
              <summary>{t("transcript.thinking")}</summary>
              <div className="reply-think-text">{r.text}</div>
            </details>
          );
        if (r.kind === "error")
          return <div key={j} className="reply-err">! {r.text}</div>;
        if (r.kind === "tool") {
          const verb = (r.ev.tool ? TOOL_VERB[r.ev.tool] : undefined) || r.ev.name || r.ev.tool || "tool";
          const arg = toolPrimaryArg(r.ev);
          const out = r.result ? resultBody(r.result.output) : "";
          return (
            <div key={j} className="reply-tool">
              <span className="reply-tool-name">{arg ? `${verb}(${truncate(arg, 80)})` : verb}</span>
              {out ? <span className="reply-tool-out">→ {truncate(previewText(out), 100)}</span> : null}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function AssertDetail({ asserts, t }: { asserts: Assertion[]; t: T }) {
  return (
    <div className="line-detail assert-detail">
      {asserts.map((a: Assertion, i: number) => (
        <div key={i} className="assert-row">
          <span className={`abadge ${a.passed ? "good" : "bad"}`}>{a.passed ? t("assert.pass") : t("assert.fail")}</span>
          <span className="assert-name">{a.name}</span>
          {a.severity === "soft" ? <span className="assert-sev">{t("assert.soft")}</span> : null}
          {a.threshold !== undefined ? (
            <span className="assert-score">
              {formatScore(a.score)} / {formatScore(a.threshold)}
            </span>
          ) : null}
          {a.detail ? <div className="assert-reason">{a.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}

const TS_HL_RE =
  /(\/\/[^\n]*)|(\/\*[^]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|default|const|let|var|async|await|function|return|if|else|for|of|in|new|class|extends|typeof|void|true|false|null|undefined)\b|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;

/** 轻量 TS 着色(逐行,零依赖):注释 / 字符串 / 关键字 / 数字 / 函数名。 */
function highlightTs(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  TS_HL_RE.lastIndex = 0;
  while ((m = TS_HL_RE.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls = m[1] || m[2] ? "tok-comment" : m[3] ? "tok-str" : m[4] ? "tok-kw" : m[5] ? "tok-num" : m[6] ? "tok-fn" : null;
    out.push(cls ? <span key={i++} className={cls}>{m[0]}</span> : m[0]);
    last = m.index + m[0].length;
    if (m[0].length === 0) TS_HL_RE.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/**
 * 没源码可叠时(此 run 早于 source-loc,或源码不可读:远程沙箱等)。不退回老的分组视图——
 * 用代码视图同一套视觉语言:一句说明 + checks(绿过/红不过)+ 原始会话流。重跑即可看到代码视图。
 */
function NoSourceBody({ assertions, events, t }: { assertions: Assertion[]; events: TranscriptEvent[]; t: T }) {
  const checks = assertions || [];
  return (
    <div className="nosource">
      <div className="nosource-note">
        {t("code.noSource")}
      </div>
      {checks.length ? (
        <div className="nosource-block">
          <div className="nosource-head">{t("code.checks")}</div>
          <AssertDetail asserts={checks} t={t} />
        </div>
      ) : null}
      {events?.length ? (
        <div className="nosource-block">
          <div className="nosource-head">{t("code.conversation")}</div>
          <Transcript events={events} t={t} />
        </div>
      ) : null}
    </div>
  );
}

function CopyReason({ text, t }: { text: string; t: T }) {
  const [copied, setCopied] = useState(false);
  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button className={`copy-reason${copied ? " is-copied" : ""}`} onClick={copy} aria-label={t("action.copyReason")} title={t("action.copyReason")}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

function CopyAllErrors({ rows, t }: { rows: ViewRow[]; t: T }) {
  const [copied, setCopied] = useState(false);

  const errorEntries = rows.flatMap((row: ViewRow) =>
    (row.results ?? [])
      .filter((r: ViewResult) => {
        const outcome = outcomeOf(r);
        return outcome === "failed" || outcome === "errored";
      })
      .map((r: ViewResult) => {
        const failedAssertions = failingAssertions(r);
        const reason = reasonFor(r, failedAssertions);
        const traceBase = r.artifactAbsBase || r.artifactBase;
        const tracePath = r.hasTrace && traceBase ? `${traceBase}/trace.json` : null;
        return { experimentName: row.label, evalId: r.id, reason, tracePath };
      })
  );

  if (!errorEntries.length) return null;

  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const text = errorEntries
      .map(({ experimentName, evalId, reason, tracePath }: { experimentName: string; evalId: string; reason: string; tracePath: string | null }) =>
        [
          `实验: ${experimentName}  Eval: ${evalId}`,
          reason ? `错误: ${reason}` : null,
          tracePath ? `Trace: ${tracePath}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button className={`copy-all-errors${copied ? " is-copied" : ""}`} onClick={copy} title={t("action.copyErrors")}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? t("action.copied") : `${t("action.copyErrors")} (${errorEntries.length})`}</span>
    </button>
  );
}

function LazyArtifact({ type, src, autoLoad = false, t }: { type: LazyArtifactType; src: string; autoLoad?: boolean; t: T }) {
  const [open, setOpen] = useState(autoLoad);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState<unknown>(null);
  const [error, setError] = useState("");

  const load = async () => {
    if (loaded) return;
    setLoaded(true);
    try {
      const resp = await fetch("/artifact?p=" + encodeURIComponent(src));
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const body = await resp.json();
      setContent(body);
      setError("");
    } catch (e) {
      setLoaded(false);
      setError(`${t("trace.loadFailed")} ${String(e)}`);
    }
  };

  useEffect(() => {
    if (autoLoad) void load();
  }, []);

  return (
    <details
      className="trace-details"
      open={open}
      onToggle={(e) => {
        const isOpen = e.currentTarget.open;
        setOpen(isOpen);
        if (isOpen) void load();
      }}
    >
      <summary>{type === "transcript" ? t("trace.transcript") : t("trace.timing")}</summary>
      <div className="trace-slot">
        {error ? <div className="trace-span-meta">{error}</div> : !content ? <div className="trace-span-meta">{t("trace.loading")}</div> : null}
        {content && type === "transcript" ? <Transcript events={asEvents(content) ?? []} t={t} /> : null}
        {content && type === "trace" ? <Trace spans={asSpans(content) ?? []} t={t} /> : null}
      </div>
    </details>
  );
}

function Trace({ spans, t }: { spans: Span[]; t: T }) {
  if (!spans?.length) return <div className="trace-span-meta">{t("trace.noSpans")}</div>;
  const t0 = Math.min(...spans.map((s) => s.startMs));
  const t1 = Math.max(...spans.map((s) => s.endMs));
  const total = Math.max(1, t1 - t0);
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depthOf = (span: Span): number => {
    let depth = 0;
    let cur = span;
    const seen = new Set();
    while (cur && cur.parentSpanId && byId.has(cur.parentSpanId) && !seen.has(cur.spanId)) {
      seen.add(cur.spanId);
      const next = byId.get(cur.parentSpanId);
      if (!next) break;
      cur = next;
      depth++;
      if (depth > 40) break;
    }
    return depth;
  };
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs || depthOf(a) - depthOf(b));
  return (
    <div className="trace">
      <div className="trace-span-meta">
        {t("trace.total")} {formatDuration(total)} · {spans.length} {t("trace.spans")} · {t("trace.clickDetails")}
      </div>
      {ordered.map((span) => {
        const left = ((span.startMs - t0) / total) * 100;
        const width = Math.max(0.6, ((span.endMs - span.startMs) / total) * 100);
        const kind = span.kind || "other";
        const tone = span.status === "error" ? "bad" : "k-" + kind;
        const detail = spanAttrs(span.attributes);
        const row = (
          <summary className="trace-row">
            <div className="trace-label" style={{ paddingLeft: depthOf(span) * 12 }} title={span.name}>
              {kind !== "other" ? <span className={`kind-chip k-${kind}`}>{kind}</span> : null}
              {span.name}
            </div>
            <div className="trace-track">
              <div className={`trace-bar ${tone}`} style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
            <div className="trace-dur num">{formatDuration(span.endMs - span.startMs)}</div>
          </summary>
        );
        return detail ? (
          <details className="span-d" key={span.spanId}>
            {row}
            {detail}
          </details>
        ) : (
          <div className="span-d" key={span.spanId}>
            {row}
          </div>
        );
      })}
    </div>
  );
}

function spanAttrs(attrs?: Record<string, ViewJson>): ReactNode {
  if (!attrs) return null;
  const hide = /^(code\.|thread\.|target$|busy_ns$|idle_ns$|rpc\.|app_server\.)/;
  const keys = Object.keys(attrs).filter((k) => !hide.test(k));
  if (!keys.length) return null;
  const io = keys.filter((k) => k.startsWith("io."));
  const rest = keys.filter((k) => !k.startsWith("io.")).sort();
  return (
    <div className="span-attrs">
      {io.map((key) => {
        const label = key.replace(/^io\./, "");
        const value = String(attrs[key]);
        return label === "input" || label === "output" ? (
          <div className="attr-io" key={key}>
            <span className="attr-k">{label}</span>
            <pre className="attr-pre">{value}</pre>
          </div>
        ) : (
          <AttrRow key={key} label={label} value={value} />
        );
      })}
      {rest.map((key) => (
        <AttrRow key={key} label={key} value={typeof attrs[key] === "object" ? JSON.stringify(attrs[key]) : String(attrs[key])} />
      ))}
    </div>
  );
}

function AttrRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="attr-row">
      <span className="attr-k">{label}</span>
      <span className="attr-v">{value}</span>
    </div>
  );
}

const TOOL_VERB: Record<string, string> = {
  file_read: "Read",
  file_write: "Write",
  file_edit: "Edit",
  shell: "Bash",
  web_fetch: "Fetch",
  web_search: "Search",
  glob: "Glob",
  grep: "Grep",
  list_dir: "List",
  agent_task: "Task",
};

function Transcript({ events, t }: { events: TranscriptEvent[]; t: T }) {
  if (!Array.isArray(events) || !events.length) return <div className="trace-span-meta">{t("transcript.noEvents")}</div>;
  const resultByCall = new Map<string, ToolResultEvent>();
  for (const event of events) {
    if (event.type === "action.result" || event.type === "subagent.completed") resultByCall.set(event.callId, event);
  }
  const pairedResult = new Set<string>();
  return (
    <div className="transcript">
      {events.map((event, index) => {
        switch (event.type) {
          case "message":
            return <MessageBlock event={event} t={t} key={index} />;
          case "thinking":
            return <ThinkBlock event={event} t={t} key={index} />;
          case "action.called": {
            const result = resultByCall.get(event.callId);
            if (result) pairedResult.add(event.callId);
            return <ToolBlock call={event} result={result} t={t} key={index} />;
          }
          case "subagent.called": {
            const result = resultByCall.get(event.callId);
            if (result) pairedResult.add(event.callId);
            return (
              <ToolBlock
                call={{ tool: "agent_task", name: event.name, input: { description: event.name, ...(event.remoteUrl ? { remoteUrl: event.remoteUrl } : {}) } }}
                result={result}
                t={t}
                key={index}
              />
            );
          }
          case "action.result":
          case "subagent.completed":
            return pairedResult.has(event.callId) ? null : (
              <ToolBlock call={{ tool: "unknown", name: "result", input: null }} result={event} t={t} key={index} />
            );
          case "input.requested":
            return <InputBlock event={event} t={t} key={index} />;
          case "compaction":
            return (
              <div className="ts-compaction" key={index}>
                {t("transcript.contextCompacted")}{event.reason ? " · " + event.reason : ""}
              </div>
            );
          case "error":
            return (
              <div className="ts-error" key={index}>
                ! {event.message || "error"}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function MessageBlock({ event, t }: { event: Extract<TranscriptEvent, { type: "message" }>; t: T }) {
  const who = event.role === "assistant" ? "assistant" : "user";
  return (
    <div className={`ts-msg ts-${who}`}>
      <span className="ts-role">{who === "assistant" ? t("transcript.assistant") : t("transcript.user")}</span>
      <div className="ts-text">{event.text || ""}</div>
    </div>
  );
}

function ThinkBlock({ event, t }: { event: Extract<TranscriptEvent, { type: "thinking" }>; t: T }) {
  return (
    <details className="ts-think">
      <summary>{t("transcript.thinking")}</summary>
      <div className="ts-think-text">{event.text || ""}</div>
    </details>
  );
}

function InputBlock({ event, t }: { event: Extract<TranscriptEvent, { type: "input.requested" }>; t: T }) {
  const request = event.request || {};
  const opts = (request.options || []).map((o: { id: string; label?: string }) => o.label || o.id).filter(Boolean).join("  /  ");
  const body = (request.prompt || t("transcript.awaitingInput")) + (opts ? "\n[ " + opts + " ]" : "");
  return (
    <div className="ts-msg ts-input">
      <span className="ts-role">{t("transcript.inputRequested")}</span>
      <div className="ts-text">{body}</div>
    </div>
  );
}

function ToolBlock({ call, result, t }: { call: ToolBlockCall; result?: ToolResultEvent; t: T }) {
  const verb = (call.tool ? TOOL_VERB[call.tool] : undefined) || call.name || call.tool || "tool";
  const arg = toolPrimaryArg(call);
  const label = arg ? `${verb}(${arg})` : verb;
  const status = result ? result.status : "pending";
  const dot = status === "failed" ? "bad" : status === "rejected" ? "warn" : status === "pending" ? "pending" : "good";
  const inputStr = call.input == null ? "" : prettyJson(call.input);
  const outBody = result ? resultBody(result.output) : "";
  const preview = result ? previewText(outBody) : t("transcript.running");
  return (
    <details className="ts-tool-d">
      <summary className="ts-row">
        <span className={`ts-dot ${dot}`} />
        <span className="ts-tool" title={label}>
          {label}
        </span>
        <span className="ts-preview">{truncate(preview, 140)}</span>
      </summary>
      <div className="ts-body">
        {inputStr ? (
          <div className="ts-field">
            <span className="ts-k">{t("transcript.input")}</span>
            <pre className="attr-pre">{truncate(inputStr, 4000)}</pre>
          </div>
        ) : null}
        {result ? (
          <div className="ts-field">
            <span className="ts-k">{t("transcript.output")}{result.status && result.status !== "completed" ? " · " + result.status : ""}</span>
            <pre className="attr-pre">{outBody ? truncate(outBody, 8000) : <span className="reason-empty">{t("transcript.empty")}</span>}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function RunsView({ rows, t }: { rows: ViewRow[]; t: T }) {
  const [query, setQuery] = useState("");
  const allRuns = useMemo(
    () => rows.flatMap((row: ViewRow) => (row.results ?? []).map((r: ViewResult): RowRun => ({ ...r, rowLabel: row.label, rowAgent: row.agent, rowModel: row.model }))),
    [rows],
  );
  const filtered = allRuns.filter((r: RowRun) => {
    const q = query.trim().toLowerCase();
    return !q || `${r.id} ${r.rowLabel} ${r.rowAgent} ${r.rowModel || ""}`.toLowerCase().includes(q);
  });
  return (
    <section id="tab-runs">
      <div className="section-head">
        <h2>{t("section.individualRuns")}</h2>
        <div className="controls">
          <input
            className="search"
            type="search"
            placeholder={t("search.runs")}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {!allRuns.length ? (
        <div className="empty">{t("empty.individualRuns")}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("table.evalId")}</th>
                <th>{t("table.experiment")}</th>
                <th>{t("table.outcome")}</th>
                <th>{t("table.agent")}</th>
                <th>{t("table.model")}</th>
                <th>{t("metric.duration")}</th>
                <th>{t("table.tokens")}</th>
                <th>{t("table.estCost")}</th>
                <th>{t("table.ranAt")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map((r: RowRun) => {
                  const outcome = outcomeOf(r);
                  return (
                    <tr key={`${r.id}-${r.rowLabel}-${r.attempt}`}>
                      <td>
                        <span className="name">{r.id}</span>
                      </td>
                      <td>{r.rowLabel}</td>
                      <td className={outcomeClass(outcome)}>{outcomeLabel(outcome, t)}</td>
                      <td>{r.rowAgent}</td>
                      <td>{r.rowModel || t("config.default")}</td>
                      <td className="num">{formatDuration(r.durationMs)}</td>
                      <td className="num">{formatTokens(totalTokens(r.usage))}</td>
                      <td className="num">{formatCost(r.estimatedCostUSD)}</td>
                      <td className="num">{r.startedAt ? formatDateTime(r.startedAt) : "-"}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
                    {t("empty.runsFilter")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TracesView({ rows, t }: { rows: ViewRow[]; t: T }) {
  const allRuns = useMemo(
    () => rows.flatMap((row: ViewRow) => (row.results ?? []).map((r: ViewResult): RowRun => ({ ...r, rowLabel: row.label, rowAgent: row.agent, rowModel: row.model }))),
    [rows],
  );
  const traceable = allRuns.filter((r: RowRun) => r.hasEvents || r.hasTrace);
  return (
    <section id="tab-traces">
      <div className="section-head">
        <h2>{t("section.traces")}</h2>
      </div>
      {!traceable.length ? (
        <div className="empty">{t("empty.traces")}</div>
      ) : (
        traceable.map((r: RowRun) => {
          const outcome = outcomeOf(r);
          return (
            <div className="traces-entry" key={`${r.id}-${r.rowLabel}-${r.attempt}`}>
              <div className="traces-entry-head">
                <span className={`${outcomeClass(outcome)} traces-verdict`}>{outcomeLabel(outcome, t)}</span>
                <span className="eval-id">{r.id}</span>
                <span className="traces-exp">{r.rowLabel}</span>
                <span className="num traces-dur">{formatDuration(r.durationMs)}</span>
              </div>
              {r.hasEvents && r.artifactBase ? <LazyArtifact type="transcript" src={`${r.artifactBase}/events.json`} t={t} /> : null}
              {r.hasTrace && r.artifactBase ? <LazyArtifact type="trace" src={`${r.artifactBase}/trace.json`} t={t} /> : null}
            </div>
          );
        })
      )}
    </section>
  );
}

function buildGroupMap(rows: ViewRow[]): Map<string, ViewRow[]> {
  const map = new Map<string, ViewRow[]>();
  for (const row of rows) {
    if (!row.group) continue;
    if (!map.has(row.group)) map.set(row.group, []);
    map.get(row.group)?.push(row);
  }
  return map;
}

function compareRows(a: ViewRow, b: ViewRow, key: SortKey): number {
  const av = valueFor(a, key);
  const bv = valueFor(b, key);
  if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv));
  return Number(av) - Number(bv);
}

function valueFor(row: ViewRow, key: SortKey): string | number {
  if (key === "experiment") return row.label;
  if (key === "model") return row.model || "";
  if (key === "agent") return row.agent;
  if (key === "cost") return row.estimatedCostUSD || 0;
  if (key === "tokens") return totalTokens(row.usage);
  return row[key] || 0;
}

function configChips(row: ViewRow, t: T): [string, ReactNode][] {
  const exp = row.experiment || {};
  const flags = exp.flags && Object.keys(exp.flags).length
    ? Object.entries(exp.flags).map(([k, v]) => k + "=" + formatConfigValue(v)).join(", ")
    : t("config.flagsNone");
  return [
    [t("config.experiment"), row.experimentId || row.label],
    [t("table.model"), row.model || t("config.default")],
    ["agent", row.agent],
    ["runs", exp.runs ?? row.runs],
    ["earlyExit", exp.earlyExit === undefined ? t("config.notApplicable") : String(exp.earlyExit)],
    ["sandbox", exp.sandbox || t("config.default")],
    ["budget", exp.budget === undefined ? t("config.none") : "$" + exp.budget],
    ["flags", flags],
  ];
}

function outcomeOf(result: ViewResult): Outcome {
  const raw: string = result.outcome || (result.error ? "errored" : result.verdict);
  // "scored" = soft-only failures, no gate failed → counts as pass
  return raw === "scored" ? "passed" : raw;
}

function outcomeClass(outcome: Outcome): string {
  return outcome === "passed" ? "good" : outcome === "errored" ? "infra-err" : outcome === "failed" ? "bad" : "warn";
}

function outcomeLabel(outcome: Outcome, t: T): string {
  if (outcome === "passed") return t("status.pass");
  if (outcome === "failed") return t("status.fail");
  if (outcome === "errored") return t("status.error");
  if (outcome === "skipped") return t("status.skipped");
  return outcome || "—";
}

// Only gate-severity failures are eval "failure reasons"; soft failures show as scores
function failingAssertions(result: ViewResult): Assertion[] {
  return (result.assertions || []).filter((a: Assertion) => !a.passed && a.severity === "gate");
}

function reasonFor(result: ViewResult, failedGates: Assertion[]): string {
  if (result.error) return result.error;
  if (result.skipReason) return result.skipReason;
  return failedGates.map((a: Assertion) => (a.detail ? `${a.name}: ${a.detail}` : a.name)).join(", ");
}

function scoresSummary(assertions: Assertion[]): string {
  const scored = (assertions || []).filter((a: Assertion) => a.score !== undefined && a.score !== null);
  if (!scored.length) return "";
  return scored
    .map((a: Assertion) => {
      const s = formatScore(a.score);
      return a.threshold !== undefined ? `${a.name} ${s}/${formatScore(a.threshold)}` : `${a.name} ${s}`;
    })
    .join(" · ");
}

function outcomeSummary(row: ViewRow, t: T): string {
  // fold "scored" (soft-only) into passed count
  const passed = (row.passed || 0) + (row.scored || 0);
  const parts = [`${passed} ${t("outcome.passed")}`, `${row.failed} ${t("outcome.failed")}`];
  if (row.errored) parts.push(`${row.errored} ${t("outcome.errored")}`);
  if (row.skipped) parts.push(`${row.skipped} ${t("outcome.skipped")}`);
  return parts.join(" / ");
}

function toolPrimaryArg(call: ToolBlockCall): string {
  const input = call.input;
  if (typeof input === "string") return input;
  if (!isObjectRecord(input)) return "";
  if (call.tool === "shell") {
    const command = input.command ?? input.cmd;
    if (typeof command === "string") return command;
    if (Array.isArray(command)) return command.filter((x: ViewJson) => typeof x === "string").join(" ");
  }
  for (const key of ["path", "file", "file_path", "filename", "pattern", "query", "url", "uri", "prompt", "description", "command", "remoteUrl"]) {
    const value = input[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function resultBody(output: ViewJson | undefined): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (isObjectRecord(output)) {
    for (const key of ["output", "stdout", "content", "text", "result", "body"]) {
      const value = output[key];
      if (typeof value === "string") return value;
    }
  }
  return prettyJson(output);
}

function prettyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function previewText(value: string): string {
  return String(value).split("\n").find((line) => line.trim()) || "";
}

function truncate(value: unknown, n: number): string {
  const str = String(value);
  return str.length > n ? str.slice(0, n) + " ... [+" + (str.length - n) + " chars]" : str;
}

function formatConfigValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function totalTokens(usage?: ViewUsage): number {
  return (usage?.inputTokens || 0) + (usage?.outputTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0);
}

function formatPercent(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0%";
  return Math.round(value * 100) + "%";
}

/** 断言 / judge 分数本就是 0–1,直接展示原值(去掉末尾零),不转百分比。pass-rate 之类的「比率」仍用 formatPercent。 */
function formatScore(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return String(Number(value.toFixed(2)));
}

function formatDuration(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms >= 60000) return (ms / 60000).toFixed(1) + "m";
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return Math.round(ms) + "ms";
}

function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
  if (value >= 1000) return (value / 1000).toFixed(1) + "k";
  return String(Math.round(value));
}

function formatCost(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "$0";
  return "$" + value.toFixed(value < 1 ? 3 : 2);
}

function formatDateTime(iso?: string): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatClock(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function asSources(value: unknown): CodeSource[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(isCodeSource) ? value : null;
}

function isCodeSource(value: unknown): value is CodeSource {
  return isObjectRecord(value) && typeof value.path === "string" && typeof value.content === "string";
}

function asEvents(value: unknown): TranscriptEvent[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(isTranscriptEvent) ? value : null;
}

function asSpans(value: unknown): Span[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(isSpan) ? value : null;
}

function isTranscriptEvent(value: unknown): value is TranscriptEvent {
  if (!isObjectRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "message":
      return (value.role === "assistant" || value.role === "user") && typeof value.text === "string";
    case "action.called":
      return typeof value.callId === "string" && typeof value.name === "string";
    case "action.result":
      return typeof value.callId === "string";
    case "subagent.called":
      return typeof value.callId === "string" && typeof value.name === "string";
    case "subagent.completed":
      return typeof value.callId === "string";
    case "input.requested":
      return isObjectRecord(value.request);
    case "thinking":
      return typeof value.text === "string";
    case "compaction":
      return true;
    case "error":
      return typeof value.message === "string";
    default:
      return false;
  }
}

function isSpan(value: unknown): value is Span {
  return (
    isObjectRecord(value) &&
    typeof value.traceId === "string" &&
    typeof value.spanId === "string" &&
    typeof value.name === "string" &&
    typeof value.startMs === "number" &&
    typeof value.endMs === "number"
  );
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(<App data={initialData} />);
