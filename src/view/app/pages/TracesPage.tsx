import { useMemo } from "react";
import type { RowRun, T } from "../shared.ts";
import type { ViewResult, ViewRow } from "../types.ts";
import { outcomeClass, outcomeLabel } from "../lib/outcome.ts";
import { formatDuration } from "../lib/format.ts";
import { LazyArtifact } from "../components/LazyArtifact.tsx";

export function TracesView({ rows, t }: { rows: ViewRow[]; t: T }) {
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
          const outcome = r.outcome;
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
