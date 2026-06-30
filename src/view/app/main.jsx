import React, { useMemo, useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Copy } from "lucide-react";
import "../styles.css";

const initialData = window.__FASTEVAL_VIEW_DATA__ ?? {
  rows: [],
  lastRun: "No runs yet",
  passRate: "0%",
  resultCount: "0",
  duration: "0ms",
  cost: "$0",
};

function resultFromUrl(rows) {
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

function App({ data }) {
  const rows = data.rows ?? [];
  const [tab, setTab] = useState("experiments");
  const [sort, setSort] = useState({ key: "passRate", dir: -1 });
  const [query, setQuery] = useState("");
  const [openRows, setOpenRows] = useState(() => new Set());
  const [selectedGroup, setSelectedGroup] = useState(() => {
    const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort();
    return groups[0] ?? null;
  });
  const [modalResult, setModalResult] = useState(() => resultFromUrl(rows));

  const openModal = useCallback((result) => {
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

  const groupMap = useMemo(() => buildGroupMap(rows), [rows]);
  const pool = selectedGroup ? groupMap.get(selectedGroup) ?? [] : rows;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((row) => {
        if (!q) return true;
        return [
          row.label,
          row.group || "",
          row.experimentId || "",
          row.agent,
          row.model || "",
          ...(row.results ?? []).map((r) => r.id),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => compareRows(a, b, sort.key) * sort.dir);
  }, [pool, query, sort]);

  const setSortKey = (key) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir * -1 } : { key, dir: key === "experiment" || key === "agent" ? 1 : -1 },
    );
  };

  const toggleRow = (key) => {
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
        <nav className="nav" aria-label="Report">
          {["experiments", "runs", "traces"].map((name) => (
            <button key={name} className={`nav-tab${tab === name ? " is-active" : ""}`} onClick={() => setTab(name)}>
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <section className="hero">
          <h1>Eval Run Results</h1>
          <div className="meta">
            <span>
              <b>Last run:</b> {data.lastRun}
            </span>
          </div>
        </section>

        <section className="summary" aria-label="Run summary">
          <Metric label="Pass Rate" value={data.passRate} />
          <Metric label="Eval Results" value={data.resultCount} />
          <Metric label="Duration" value={data.duration} />
          <Metric label="Estimated Cost" value={data.cost} />
        </section>

        {tab === "experiments" && (
          <section id="tab-experiments">
            <div className="section-head">
              <h2>Experiments</h2>
            </div>
            <GroupSelector groupMap={groupMap} selectedGroup={selectedGroup} onSelect={setSelectedGroup} />
            <div className="section-sub-head">
              <span className="group-detail-label">{selectedGroup ?? ""}</span>
              <div className="controls">
                <input
                  className="search"
                  type="search"
                  placeholder="Filter experiment, agent, model, or eval..."
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <CopyAllErrors rows={filtered} />
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
              />
            ) : (
              <div className="empty">
                No summary.json files found. Run <code>fasteval</code> or pass{" "}
                <code>fasteval view path/to/summary.json</code>.
              </div>
            )}
          </section>
        )}

        {tab === "runs" && <RunsView rows={rows} />}
        {tab === "traces" && <TracesView rows={rows} />}
      </main>
      {modalResult && <AttemptModal result={modalResult} onClose={closeModal} />}
    </>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function GroupSelector({ groupMap, selectedGroup, onSelect }) {
  if (!groupMap.size) return <div id="group-selector" className="group-selector" />;
  return (
    <div id="group-selector" className="group-selector">
      {[...groupMap.keys()].sort().map((group) => {
        const groupRows = groupMap.get(group) ?? [];
        const allResults = groupRows.flatMap((r) => r.results ?? []);
        const passed = allResults.filter((r) => outcomeOf(r) === "passed").length;
        const failed = allResults.filter((r) => outcomeOf(r) === "failed").length;
        const errored = allResults.filter((r) => outcomeOf(r) === "errored").length;
        const passRate = allResults.length ? passed / allResults.length : 0;
        const tone = passRate >= 0.8 ? "good" : passRate >= 0.5 ? "warn" : "bad";
        const totalCost = groupRows.reduce((s, r) => s + (r.estimatedCostUSD || 0), 0);
        const lastRun = groupRows
          .map((r) => r.lastRunAt)
          .filter(Boolean)
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
              {groupRows.length} experiment{groupRows.length === 1 ? "" : "s"} · {failed} failed
              {errored ? ` · ${errored} errors` : ""} · {formatCost(totalCost)}
            </div>
            {lastRun ? <div className="group-card-time">{formatDateTime(lastRun)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function ExperimentTable({ rows, sort, setSortKey, openRows, toggleRow, openModal }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortHeader name="Experiment" sortKey="experiment" sort={sort} onSort={setSortKey} />
            <SortHeader name="Model" sortKey="model" sort={sort} onSort={setSortKey} />
            <SortHeader name="Agent" sortKey="agent" sort={sort} onSort={setSortKey} />
            <SortHeader name="Avg Duration" sortKey="avgDurationMs" sort={sort} onSort={setSortKey} />
            <SortHeader name="Success Rate" sortKey="passRate" sort={sort} onSort={setSortKey} />
            <SortHeader name="Tokens" sortKey="tokens" sort={sort} onSort={setSortKey} />
            <SortHeader name="Est. Cost" sortKey="cost" sort={sort} onSort={setSortKey} />
            <th>Outcomes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <React.Fragment key={row.key}>
              <ExperimentRow row={row} open={openRows.has(row.key)} onToggle={() => toggleRow(row.key)} />
              {openRows.has(row.key) ? <ExperimentDetail row={row} openModal={openModal} /> : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({ name, sortKey, sort, onSort }) {
  const sorted = sort.key === sortKey ? (sort.dir === 1 ? "asc" : "desc") : undefined;
  return (
    <th>
      <button data-sorted={sorted} onClick={() => onSort(sortKey)}>
        {name}
      </button>
    </th>
  );
}

function ExperimentRow({ row, open, onToggle }) {
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
          {row.runs} eval result{row.runs === 1 ? "" : "s"}
          {row.lastRunAt ? ` · ${formatDateTime(row.lastRunAt)}` : ""}
        </div>
      </td>
      <td>{row.model || "default"}</td>
      <td>{row.agent}</td>
      <td className="num">{formatDuration(row.avgDurationMs)}</td>
      <td className={`num ${tone}`}>{formatPercent(row.passRate)}</td>
      <td className="num">{formatTokens(totalTokens(row.usage))}</td>
      <td className="num">{formatCost(row.estimatedCostUSD)}</td>
      <td>
        <span className="pill">{outcomeSummary(row)}</span>
      </td>
    </tr>
  );
}

function ExperimentDetail({ row, openModal }) {
  const totalDuration = (row.results ?? []).reduce((sum, r) => sum + (r.durationMs || 0), 0);
  const sampleResult =
    row.results?.find((r) => outcomeOf(r) === "errored") ||
    row.results?.find((r) => outcomeOf(r) === "failed") ||
    row.results?.[0] ||
    {};
  const results = [...(row.results ?? [])].sort((a, b) => a.id.localeCompare(b.id) || a.attempt - b.attempt);
  return (
    <tr className="detail-row">
      <td className="detail-cell" colSpan={8}>
        <div className="detail">
          <div className="config-strip">
            {configChips(row).map(([label, value]) => (
              <span className="config-chip" key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </span>
            ))}
          </div>
          <div className="detail-kpis">
            <Kpi label="Attempts" value={row.runs} />
            <Kpi label="Passed" value={row.passed} className="good" />
            <Kpi label="Failed" value={row.failed} className={row.failed ? "bad" : ""} />
            <Kpi label="Errored" value={row.errored} className={row.errored ? "infra-err" : ""} />
            <Kpi label="Total Time" value={formatDuration(totalDuration)} />
            <Kpi label="Total Cost" value={formatCost(row.estimatedCostUSD)} />
            <Kpi label="Ran" value={formatDateTime(row.lastRunAt)} title={row.lastRunAt || ""} />
          </div>
          <h3>Evaluation Attempts</h3>
          <div className="eval-list">
            <div className="eval-grid-head">
              <span>Status</span>
              <span>Eval</span>
              <span>Reason</span>
              <span>Time</span>
              <span>Tokens</span>
              <span>Cost</span>
              <span>Run</span>
            </div>
            {results.map((result) => (
              <Attempt key={`${result.id}-${result.attempt}`} result={result} totalRuns={row.runs} openModal={openModal} />
            ))}
          </div>
          <details className="raw-details">
            <summary>
              Raw sample result <span className="raw-note">debug JSON, defaults to first error/failure when available</span>
            </summary>
            <pre>{JSON.stringify(sampleResult, null, 2)}</pre>
          </details>
        </div>
      </td>
    </tr>
  );
}

function Kpi({ label, value, className = "", title }) {
  return (
    <div className="detail-kpi">
      <span>{label}</span>
      <b className={className} title={title}>
        {value}
      </b>
    </div>
  );
}

function Attempt({ result, totalRuns, openModal }) {
  const outcome = outcomeOf(result);
  const gates = failingAssertions(result);
  const reason = reasonFor(result, gates);
  const allAssertions = result.assertions || [];
  const hasScores = allAssertions.some((a) => a.score !== undefined && a.score !== null);
  const hasBody = result.hasEvents || result.hasTrace || hasScores;

  const inlineScores = !reason && outcome === "passed" ? scoresSummary(allAssertions) : "";
  const displayReason = reason || inlineScores;

  const handleOpen = hasBody ? () => openModal(result) : null;

  const cells = (
    <>
      <span className="attempt-status">
        <span className={outcomeClass(outcome)}>{outcomeLabel(outcome)}</span>
      </span>
      <span className="eval-id">{result.id}</span>
      <div className="assertions-cell">
        <span
          className={`assertions${hasBody ? " assertions-link" : ""}`}
          title={displayReason || undefined}
          onClick={handleOpen ? (e) => { e.stopPropagation(); handleOpen(); } : undefined}
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

function buildTurns(events) {
  const turns = [];
  let userText = null;
  let replies = [];
  for (const ev of events) {
    if (ev.type === "message" && ev.role === "user") {
      if (userText !== null) turns.push({ user: userText, replies });
      userText = ev.text || "";
      replies = [];
    } else if (ev.type === "message" && ev.role === "assistant") {
      replies.push({ kind: "text", text: ev.text || "" });
    } else if (ev.type === "thinking") {
      replies.push({ kind: "thinking", text: ev.text || "" });
    } else if (ev.type === "action.called") {
      replies.push({ kind: "tool", ev });
    }
  }
  if (userText !== null) turns.push({ user: userText, replies });
  return turns;
}

function ConversationTurns({ src }) {
  const [turns, setTurns] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/artifact?p=" + encodeURIComponent(src))
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((events) => setTurns(buildTurns(events)))
      .catch((e) => setError(String(e)));
  }, [src]);

  if (error) return <div className="conv-error">{error}</div>;
  if (!turns) return <div className="conv-loading">loading…</div>;
  if (!turns.length) return null;

  return (
    <div className="conv-turns">
      {turns.map((turn, i) => (
        <details key={i} className="conv-turn">
          <summary className="conv-user">
            <span className="conv-label">user</span>
            <span className="conv-text">{truncate(turn.user, 200)}</span>
          </summary>
          <div className="conv-replies">
            {turn.replies.map((r, j) => {
              if (r.kind === "text") return (
                <div key={j} className="conv-assistant">
                  <span className="conv-label">assistant</span>
                  <span className="conv-text">{r.text}</span>
                </div>
              );
              if (r.kind === "thinking") return (
                <details key={j} className="conv-think">
                  <summary>thinking</summary>
                  <div className="conv-think-text">{r.text}</div>
                </details>
              );
              if (r.kind === "tool") {
                const verb = TOOL_VERB[r.ev.tool] || r.ev.name || r.ev.tool || "tool";
                const arg = toolPrimaryArg(r.ev);
                return (
                  <div key={j} className="conv-tool">
                    <span className="conv-tool-name">{arg ? `${verb}(${truncate(arg, 60)})` : verb}</span>
                  </div>
                );
              }
              return null;
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

function AttemptModal({ result, onClose }) {
  const allAssertions = result.assertions || [];
  const base = result.artifactBase;
  const [data, setData] = useState({ sources: null, events: null, status: "loading" });

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!base) { setData({ sources: null, events: null, status: "none" }); return; }
    let alive = true;
    const grab = (name, has) =>
      has
        ? fetch("/artifact?p=" + encodeURIComponent(`${base}/${name}`))
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null);
    Promise.all([grab("sources.json", result.hasSources), grab("events.json", result.hasEvents)]).then(
      ([sources, events]) => { if (alive) setData({ sources, events, status: "ready" }); },
    );
    return () => { alive = false; };
  }, [base, result.hasSources, result.hasEvents]);

  const outcome = outcomeOf(result);
  const hasCode = data.sources && data.sources.length;

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-block">
            <span className={`modal-outcome ${outcomeClass(outcome)}`}>{outcomeLabel(outcome)}</span>
            <span className="modal-title">{result.id}</span>
            {result.description ? <span className="modal-desc">{result.description}</span> : null}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {result.error ? <div className="modal-error">{result.error}</div> : null}
          {data.status === "loading" ? <div className="conv-loading">loading…</div> : null}
          {hasCode ? (
            <CodeView sources={data.sources} events={data.events || []} assertions={allAssertions} />
          ) : data.status !== "loading" ? (
            <FallbackBody result={result} assertions={allAssertions} />
          ) : null}
          {result.hasTrace && base ? <LazyArtifact type="trace" src={`${base}/trace.json`} /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────── 源码对齐的代码视图(github-diff 式)─────────────────────────
// 拿 sources.json(eval 源码)+ events.json(带 loc 的 send),把每条 send / 断言的运行结果
// 叠回真实源码行:send 行折叠→展开看回复;断言行绿(过)/红(不过),judge 行带分数,展开看 CoT。

function locKey(file, line) {
  return `${file}:${line}`;
}

/** events → 按 send 的 loc 聚成「轮」:每轮含 sent 文本 + 后续 thinking/assistant/tool 回复。 */
function indexTurns(events) {
  const byKey = new Map();
  const noloc = [];
  let cur = null;
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
      const tool = [...cur.replies].reverse().find((r) => r.kind === "tool" && r.ev.callId === ev.callId);
      if (tool) tool.result = ev;
    } else if (ev.type === "error") {
      cur.replies.push({ kind: "error", text: ev.message || "error" });
    }
  }
  return { byKey, noloc };
}

/** assertions → 按 loc 聚到行。有 loc 的进 byKey,没 loc 的进 noloc(底部兜底列)。 */
function indexAsserts(assertions) {
  const byKey = new Map();
  const noloc = [];
  for (const a of assertions || []) {
    if (a.loc) {
      const k = locKey(a.loc.file, a.loc.line);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(a);
    } else {
      noloc.push(a);
    }
  }
  return { byKey, noloc };
}

function CodeView({ sources, events, assertions }) {
  const turns = useMemo(() => indexTurns(events), [events]);
  const asserts = useMemo(() => indexAsserts(assertions), [assertions]);
  const [open, setOpen] = useState(() => new Set());
  const toggle = useCallback((k) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  // 哪些 loc 被源码行覆盖到了;没覆盖到的(读不到源码的文件)放底部兜底。
  const sourceKeys = new Set();
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
        />
      ))}
      {orphanAsserts.length ? (
        <div className="code-orphans">
          <div className="code-orphans-head">other assertions</div>
          <AssertDetail asserts={orphanAsserts} />
        </div>
      ) : null}
    </div>
  );
}

function CodeFile({ file, turns, asserts, open, toggle }) {
  const lines = file.content.replace(/\n$/, "").split("\n");
  return (
    <div className="code-file">
      <div className="code-file-head">{file.path}</div>
      <div className="code-lines">
        {lines.map((text, i) => {
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
            />
          );
        })}
      </div>
    </div>
  );
}

function CodeLine({ n, text, turn, asserts, isOpen, onToggle }) {
  const hasReply = !!turn;
  const hasAsserts = !!(asserts && asserts.length);
  const status = hasAsserts ? (asserts.every((a) => a.passed) ? "pass" : "fail") : null;
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
          {hasAsserts ? asserts.map((a, i) => <AssertBadge key={i} a={a} />) : null}
          {hasReply ? <span className="reply-hint">{isOpen ? "hide" : "reply"}</span> : null}
        </span>
      </div>
      {isOpen && hasReply ? <ReplyPanel turn={turn} /> : null}
      {isOpen && hasAsserts ? <AssertDetail asserts={asserts} /> : null}
    </>
  );
}

/** 行尾分数徽章:judge / 带阈值的断言显示分数(过绿不过红);纯 gate 断言靠行色 + gutter 勾叉。 */
function AssertBadge({ a }) {
  const showPct = a.threshold !== undefined || (a.score > 0 && a.score < 1);
  if (!showPct) return null;
  return (
    <span className={`abadge ${a.passed ? "good" : "bad"}`}>
      {formatPercent(a.score)}
      {a.threshold !== undefined ? <span className="abadge-th">/{formatPercent(a.threshold)}</span> : null}
    </span>
  );
}

function ReplyPanel({ turn }) {
  if (!turn.replies.length) return <div className="line-detail reply-empty">(no reply)</div>;
  return (
    <div className="line-detail reply-panel">
      {turn.replies.map((r, j) => {
        if (r.kind === "text")
          return (
            <div key={j} className="reply-assistant">
              <span className="reply-role">assistant</span>
              <div className="reply-text">{r.text}</div>
            </div>
          );
        if (r.kind === "thinking")
          return (
            <details key={j} className="reply-think">
              <summary>thinking</summary>
              <div className="reply-think-text">{r.text}</div>
            </details>
          );
        if (r.kind === "error")
          return <div key={j} className="reply-err">! {r.text}</div>;
        if (r.kind === "tool") {
          const verb = TOOL_VERB[r.ev.tool] || r.ev.name || r.ev.tool || "tool";
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

function AssertDetail({ asserts }) {
  return (
    <div className="line-detail assert-detail">
      {asserts.map((a, i) => (
        <div key={i} className="assert-row">
          <span className={`abadge ${a.passed ? "good" : "bad"}`}>{a.passed ? "pass" : "fail"}</span>
          <span className="assert-name">{a.name}</span>
          {a.severity === "soft" ? <span className="assert-sev">soft</span> : null}
          {a.threshold !== undefined ? (
            <span className="assert-score">
              {formatPercent(a.score)} / {formatPercent(a.threshold)}
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
function highlightTs(line) {
  const out = [];
  let last = 0;
  let i = 0;
  let m;
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

/** 没源码可叠时的兜底:断言清单 + 会话流(老视图)。 */
function FallbackBody({ result, assertions }) {
  const hasScores = (assertions || []).some((a) => a.score !== undefined && a.score !== null);
  return (
    <>
      {hasScores ? <AssertionScores assertions={assertions} /> : null}
      {result.hasEvents && result.artifactBase ? (
        <ConversationTurns src={`${result.artifactBase}/events.json`} />
      ) : null}
    </>
  );
}

function AssertionScores({ assertions }) {
  const all = (assertions || []).filter((a) => a.score !== undefined && a.score !== null);
  if (!all.length) return null;

  // 按代码顺序分组，保留首次出现顺序
  const groups = [];
  const seen = new Map();
  for (const a of all) {
    const key = a.group ?? "\0ungrouped";
    if (!seen.has(key)) {
      seen.set(key, []);
      groups.push({ key, label: a.group ?? null, items: seen.get(key) });
    }
    seen.get(key).push(a);
  }

  const renderRow = (a, i) => {
    // 状态只有 pass / fail(绿 / 红);soft / gate 是严重级,作为弱化标签单列,不当状态词。
    const cls = a.passed ? "good" : "bad";
    const inner = (
      <>
        <span className={`al-score ${cls}`}>
          {formatPercent(a.score)}
          {a.threshold !== undefined ? <span className="al-threshold">/{formatPercent(a.threshold)}</span> : null}
        </span>
        <span className="al-name">{a.name}</span>
        {a.severity === "soft" ? <span className="al-sev">soft</span> : null}
        <span className={`al-badge al-badge-${cls}`}>{a.passed ? "pass" : "fail"}</span>
      </>
    );
    return a.detail ? (
      <details key={i} className="al-row al-row-detail">
        <summary className="al-row-inner">{inner}</summary>
        <pre className="al-detail">{a.detail}</pre>
      </details>
    ) : (
      <div key={i} className="al-row">
        <div className="al-row-inner">{inner}</div>
      </div>
    );
  };

  return (
    <div className="assertion-list">
      {groups.map(({ key, label, items }) =>
        label ? (
          <details key={key} className="al-group-block">
            <summary className="al-group-header">
              {label}
              {(() => {
                const allPass = items.every((a) => a.passed);
                const cls = allPass ? "good" : "bad";
                return <span className={`al-badge al-badge-${cls} al-group-badge`}>{allPass ? "pass" : "fail"}</span>;
              })()}
            </summary>
            {items.map(renderRow)}
          </details>
        ) : (
          <React.Fragment key={key}>{items.map(renderRow)}</React.Fragment>
        )
      )}
    </div>
  );
}

function CopyReason({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async (event) => {
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
    <button className={`copy-reason${copied ? " is-copied" : ""}`} onClick={copy} aria-label="Copy reason" title="Copy reason">
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

function CopyAllErrors({ rows }) {
  const [copied, setCopied] = useState(false);

  const errorEntries = rows.flatMap((row) =>
    (row.results ?? [])
      .filter((r) => {
        const outcome = outcomeOf(r);
        return outcome === "failed" || outcome === "errored";
      })
      .map((r) => {
        const failedAssertions = failingAssertions(r);
        const reason = reasonFor(r, failedAssertions);
        const traceBase = r.artifactAbsBase || r.artifactBase;
        const tracePath = r.hasTrace && traceBase ? `${traceBase}/trace.json` : null;
        return { experimentName: row.label, evalId: r.id, reason, tracePath };
      })
  );

  if (!errorEntries.length) return null;

  const copy = async (event) => {
    event.stopPropagation();
    const text = errorEntries
      .map(({ experimentName, evalId, reason, tracePath }) =>
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
    <button className={`copy-all-errors${copied ? " is-copied" : ""}`} onClick={copy} title="复制所有失败/报错的 eval 信息">
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? "已复制" : `复制错误 (${errorEntries.length})`}</span>
    </button>
  );
}

function LazyArtifact({ type, src, autoLoad = false }) {
  const [open, setOpen] = useState(autoLoad);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    if (loaded) return;
    setLoaded(true);
    try {
      const resp = await fetch("/artifact?p=" + encodeURIComponent(src));
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      setContent(await resp.json());
      setError("");
    } catch (e) {
      setLoaded(false);
      setError(`load failed (static report has no server - use fasteval view): ${String(e)}`);
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
      <summary>{type === "transcript" ? "transcript" : "timing trace"}</summary>
      <div className="trace-slot">
        {error ? <div className="trace-span-meta">{error}</div> : !content ? <div className="trace-span-meta">loading...</div> : null}
        {content && type === "transcript" ? <Transcript events={content} /> : null}
        {content && type === "trace" ? <Trace spans={content} /> : null}
      </div>
    </details>
  );
}

function Trace({ spans }) {
  if (!spans?.length) return <div className="trace-span-meta">no spans</div>;
  const t0 = Math.min(...spans.map((s) => s.startMs));
  const t1 = Math.max(...spans.map((s) => s.endMs));
  const total = Math.max(1, t1 - t0);
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depthOf = (span) => {
    let depth = 0;
    let cur = span;
    const seen = new Set();
    while (cur && cur.parentSpanId && byId.has(cur.parentSpanId) && !seen.has(cur.spanId)) {
      seen.add(cur.spanId);
      cur = byId.get(cur.parentSpanId);
      depth++;
      if (depth > 40) break;
    }
    return depth;
  };
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs || depthOf(a) - depthOf(b));
  return (
    <div className="trace">
      <div className="trace-span-meta">
        total {formatDuration(total)} · {spans.length} spans · click a row for details
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

function spanAttrs(attrs) {
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

function AttrRow({ label, value }) {
  return (
    <div className="attr-row">
      <span className="attr-k">{label}</span>
      <span className="attr-v">{value}</span>
    </div>
  );
}

const TOOL_VERB = {
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

function Transcript({ events }) {
  if (!Array.isArray(events) || !events.length) return <div className="trace-span-meta">no events</div>;
  const resultByCall = new Map();
  for (const event of events) {
    if (event.type === "action.result" || event.type === "subagent.completed") resultByCall.set(event.callId, event);
  }
  const pairedResult = new Set();
  return (
    <div className="transcript">
      {events.map((event, index) => {
        switch (event.type) {
          case "message":
            return <MessageBlock event={event} key={index} />;
          case "thinking":
            return <ThinkBlock event={event} key={index} />;
          case "action.called": {
            const result = resultByCall.get(event.callId);
            if (result) pairedResult.add(event.callId);
            return <ToolBlock call={event} result={result} key={index} />;
          }
          case "subagent.called": {
            const result = resultByCall.get(event.callId);
            if (result) pairedResult.add(event.callId);
            return (
              <ToolBlock
                call={{ tool: "agent_task", name: event.name, input: { description: event.name, ...(event.remoteUrl ? { remoteUrl: event.remoteUrl } : {}) } }}
                result={result}
                key={index}
              />
            );
          }
          case "action.result":
          case "subagent.completed":
            return pairedResult.has(event.callId) ? null : (
              <ToolBlock call={{ tool: "unknown", name: "result", input: null }} result={event} key={index} />
            );
          case "input.requested":
            return <InputBlock event={event} key={index} />;
          case "compaction":
            return (
              <div className="ts-compaction" key={index}>
                context compacted{event.reason ? " · " + event.reason : ""}
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

function MessageBlock({ event }) {
  const who = event.role === "assistant" ? "assistant" : "user";
  return (
    <div className={`ts-msg ts-${who}`}>
      <span className="ts-role">{who}</span>
      <div className="ts-text">{event.text || ""}</div>
    </div>
  );
}

function ThinkBlock({ event }) {
  return (
    <details className="ts-think">
      <summary>thinking</summary>
      <div className="ts-think-text">{event.text || ""}</div>
    </details>
  );
}

function InputBlock({ event }) {
  const request = event.request || {};
  const opts = (request.options || []).map((o) => o.label || o.id).filter(Boolean).join("  /  ");
  const body = (request.prompt || "(awaiting input)") + (opts ? "\n[ " + opts + " ]" : "");
  return (
    <div className="ts-msg ts-input">
      <span className="ts-role">input requested</span>
      <div className="ts-text">{body}</div>
    </div>
  );
}

function ToolBlock({ call, result }) {
  const verb = TOOL_VERB[call.tool] || call.name || call.tool || "tool";
  const arg = toolPrimaryArg(call);
  const label = arg ? `${verb}(${arg})` : verb;
  const status = result ? result.status : "pending";
  const dot = status === "failed" ? "bad" : status === "rejected" ? "warn" : status === "pending" ? "pending" : "good";
  const inputStr = call.input == null ? "" : prettyJson(call.input);
  const outBody = result ? resultBody(result.output) : "";
  const preview = result ? previewText(outBody) : "running...";
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
            <span className="ts-k">input</span>
            <pre className="attr-pre">{truncate(inputStr, 4000)}</pre>
          </div>
        ) : null}
        {result ? (
          <div className="ts-field">
            <span className="ts-k">output{result.status && result.status !== "completed" ? " · " + result.status : ""}</span>
            <pre className="attr-pre">{outBody ? truncate(outBody, 8000) : <span className="reason-empty">(empty)</span>}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function RunsView({ rows }) {
  const [query, setQuery] = useState("");
  const allRuns = useMemo(
    () => rows.flatMap((row) => (row.results ?? []).map((r) => ({ ...r, rowLabel: row.label, rowAgent: row.agent, rowModel: row.model }))),
    [rows],
  );
  const filtered = allRuns.filter((r) => {
    const q = query.trim().toLowerCase();
    return !q || `${r.id} ${r.rowLabel} ${r.rowAgent} ${r.rowModel || ""}`.toLowerCase().includes(q);
  });
  return (
    <section id="tab-runs">
      <div className="section-head">
        <h2>Individual Runs</h2>
        <div className="controls">
          <input
            className="search"
            type="search"
            placeholder="Filter eval ID or experiment..."
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {!allRuns.length ? (
        <div className="empty">No individual runs found.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Eval ID</th>
                <th>Experiment</th>
                <th>Outcome</th>
                <th>Agent</th>
                <th>Model</th>
                <th>Duration</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Ran At</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map((r) => {
                  const outcome = outcomeOf(r);
                  return (
                    <tr key={`${r.id}-${r.rowLabel}-${r.attempt}`}>
                      <td>
                        <span className="name">{r.id}</span>
                      </td>
                      <td>{r.rowLabel}</td>
                      <td className={outcomeClass(outcome)}>{outcomeLabel(outcome)}</td>
                      <td>{r.rowAgent}</td>
                      <td>{r.rowModel || "default"}</td>
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
                    No results match the filter.
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

function TracesView({ rows }) {
  const allRuns = useMemo(
    () => rows.flatMap((row) => (row.results ?? []).map((r) => ({ ...r, rowLabel: row.label, rowAgent: row.agent, rowModel: row.model }))),
    [rows],
  );
  const traceable = allRuns.filter((r) => r.hasEvents || r.hasTrace);
  return (
    <section id="tab-traces">
      <div className="section-head">
        <h2>Traces</h2>
      </div>
      {!traceable.length ? (
        <div className="empty">No traces available. Traces are collected during eval runs when artifacts are saved.</div>
      ) : (
        traceable.map((r) => {
          const outcome = outcomeOf(r);
          return (
            <div className="traces-entry" key={`${r.id}-${r.rowLabel}-${r.attempt}`}>
              <div className="traces-entry-head">
                <span className={`${outcomeClass(outcome)} traces-verdict`}>{outcomeLabel(outcome)}</span>
                <span className="eval-id">{r.id}</span>
                <span className="traces-exp">{r.rowLabel}</span>
                <span className="num traces-dur">{formatDuration(r.durationMs)}</span>
              </div>
              {r.hasEvents && r.artifactBase ? <LazyArtifact type="transcript" src={`${r.artifactBase}/events.json`} /> : null}
              {r.hasTrace && r.artifactBase ? <LazyArtifact type="trace" src={`${r.artifactBase}/trace.json`} /> : null}
            </div>
          );
        })
      )}
    </section>
  );
}

function buildGroupMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.group) continue;
    if (!map.has(row.group)) map.set(row.group, []);
    map.get(row.group).push(row);
  }
  return map;
}

function compareRows(a, b, key) {
  const av = valueFor(a, key);
  const bv = valueFor(b, key);
  if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv));
  return Number(av) - Number(bv);
}

function valueFor(row, key) {
  if (key === "experiment") return row.label;
  if (key === "model") return row.model || "";
  if (key === "agent") return row.agent;
  if (key === "cost") return row.estimatedCostUSD || 0;
  if (key === "tokens") return totalTokens(row.usage);
  return row[key] || 0;
}

function configChips(row) {
  const exp = row.experiment || {};
  const flags = exp.flags && Object.keys(exp.flags).length
    ? Object.entries(exp.flags).map(([k, v]) => k + "=" + formatConfigValue(v)).join(", ")
    : "none";
  return [
    ["experiment", row.experimentId || row.label],
    ["model", row.model || "default"],
    ["agent", row.agent],
    ["runs", exp.runs ?? row.runs],
    ["earlyExit", exp.earlyExit === undefined ? "n/a" : String(exp.earlyExit)],
    ["sandbox", exp.sandbox || "default"],
    ["budget", exp.budget === undefined ? "none" : "$" + exp.budget],
    ["flags", flags],
  ];
}

function outcomeOf(result) {
  const raw = result.outcome || (result.error ? "errored" : result.verdict);
  // "scored" = soft-only failures, no gate failed → counts as pass
  return raw === "scored" ? "passed" : raw;
}

function outcomeClass(outcome) {
  return outcome === "passed" ? "good" : outcome === "errored" ? "infra-err" : outcome === "failed" ? "bad" : "warn";
}

function outcomeLabel(outcome) {
  if (outcome === "passed") return "pass";
  if (outcome === "failed") return "fail";
  if (outcome === "errored") return "error";
  return outcome || "—";
}

// Only gate-severity failures are eval "failure reasons"; soft failures show as scores
function failingAssertions(result) {
  return (result.assertions || []).filter((a) => !a.passed && a.severity === "gate");
}

function reasonFor(result, failedGates) {
  if (result.error) return result.error;
  if (result.skipReason) return result.skipReason;
  return failedGates.map((a) => (a.detail ? `${a.name}: ${a.detail}` : a.name)).join(", ");
}

function scoresSummary(assertions) {
  const scored = (assertions || []).filter((a) => a.score !== undefined && a.score !== null);
  if (!scored.length) return "";
  return scored
    .map((a) => {
      const pct = formatPercent(a.score);
      return a.threshold !== undefined ? `${a.name} ${pct}/${formatPercent(a.threshold)}` : `${a.name} ${pct}`;
    })
    .join(" · ");
}

function outcomeSummary(row) {
  // fold "scored" (soft-only) into passed count
  const passed = (row.passed || 0) + (row.scored || 0);
  const parts = [`${passed} passed`, `${row.failed} failed`];
  if (row.errored) parts.push(`${row.errored} errors`);
  if (row.skipped) parts.push(`${row.skipped} skipped`);
  return parts.join(" / ");
}

function toolPrimaryArg(call) {
  const input = call.input;
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  if (call.tool === "shell") {
    const command = input.command ?? input.cmd;
    if (typeof command === "string") return command;
    if (Array.isArray(command)) return command.filter((x) => typeof x === "string").join(" ");
  }
  for (const key of ["path", "file", "file_path", "filename", "pattern", "query", "url", "uri", "prompt", "description", "command", "remoteUrl"]) {
    if (typeof input[key] === "string" && input[key]) return input[key];
  }
  return "";
}

function resultBody(output) {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (typeof output === "object" && !Array.isArray(output)) {
    for (const key of ["output", "stdout", "content", "text", "result", "body"]) {
      if (typeof output[key] === "string") return output[key];
    }
  }
  return prettyJson(output);
}

function prettyJson(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function previewText(value) {
  return String(value).split("\n").find((line) => line.trim()) || "";
}

function truncate(value, n) {
  const str = String(value);
  return str.length > n ? str.slice(0, n) + " ... [+" + (str.length - n) + " chars]" : str;
}

function formatConfigValue(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function totalTokens(usage) {
  return (usage?.inputTokens || 0) + (usage?.outputTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0);
}

function formatPercent(value) {
  return Math.round(value * 100) + "%";
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms >= 60000) return (ms / 60000).toFixed(1) + "m";
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return Math.round(ms) + "ms";
}

function formatTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
  if (value >= 1000) return (value / 1000).toFixed(1) + "k";
  return String(Math.round(value));
}

function formatCost(value) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return "$" + value.toFixed(value < 1 ? 3 : 2);
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatClock(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function copyText(text) {
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

createRoot(document.getElementById("root")).render(<App data={initialData} />);
