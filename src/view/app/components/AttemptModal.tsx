import { Fragment, useEffect, useState } from "react";
import type { ArtifactLoadState, T } from "../shared.ts";
import type { ViewResult } from "../types.ts";
import { artifactUrl } from "../lib/artifact-url.ts";
import { asEvents, asSources } from "../lib/guards.ts";
import { verdictClass, verdictLabel } from "../lib/verdict.ts";
import { CodeView, NoSourceBody } from "./CodeView.tsx";
import { CopyAttemptPrompt } from "./CopyControls.tsx";
import { LazyArtifact } from "./LazyArtifact.tsx";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Badge } from "./ui/badge.tsx";

export function AttemptModal({ result, onClose, t }: { result: ViewResult; onClose: () => void; t: T }) {
  const allAssertions = result.assertions || [];
  const base = result.artifactBase;
  const [data, setData] = useState<ArtifactLoadState>({ sources: null, events: null, status: "loading" });

  // Esc / 焦点陷阱 / 背景滚动锁 / 点遮罩关闭 都交给 Radix Dialog;这里只保留 artifact 拉取。
  useEffect(() => {
    if (!base) { setData({ sources: null, events: null, status: "none" }); return; }
    let alive = true;
    const grab = (name: string, has?: boolean): Promise<unknown> =>
      has
        ? fetch( artifactUrl(`${base}/${name}`))
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null);
    Promise.all([grab("sources.json", result.hasSources), grab("events.json", result.hasEvents)]).then(([sources, events]) => {
      if (alive) setData({ sources: asSources(sources), events: asEvents(events), status: "ready" });
    });
    return () => { alive = false; };
  }, [base, result.hasSources, result.hasEvents]);

  const verdict = result.verdict;
  const hasCode = Boolean(data.sources?.length);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-line px-[18px] pb-[11px] pt-[13px]">
          <div className="flex min-w-0 flex-col gap-[3px]">
            <Badge tone={verdictClass(verdict)}>{verdictLabel(verdict, t)}</Badge>
            <DialogTitle asChild>
              <span className="truncate text-sm font-[640] text-text">{result.id}</span>
            </DialogTitle>
            {result.description ? <span className="truncate text-xs text-muted">{result.description}</span> : null}
          </div>
          <CopyAttemptPrompt result={result} t={t} />
          <DialogClose
            aria-label={t("action.close")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-transparent text-sm text-muted transition-colors hover:border-line hover:bg-panel-2 hover:text-text"
          >
            x
          </DialogClose>
        </div>
        <div className="flex-1 overflow-y-auto px-[18px] pb-[18px] pt-[14px]">
          {result.error ? (
            <div className="modal-error">
              <ErrorDetailBlock error={result.error} />
            </div>
          ) : null}
          {result.diagnostics && result.diagnostics.length > 0 ? (
            <AttemptDiagnostics diagnostics={result.diagnostics} />
          ) : null}
          {result.phases && result.phases.length > 0 ? <PhaseTimingBlock phases={result.phases} /> : null}
          <UsageDiffLine result={result} />
          {data.status === "loading" ? <div className="conv-loading">{t("trace.loading")}</div> : null}
          {hasCode ? (
            <CodeView sources={data.sources ?? []} events={data.events || []} assertions={allAssertions} t={t} />
          ) : data.status !== "loading" ? (
            // hasSources 为真却取不到 → 源码捕获过,是 artifact 文件在当前托管里缺失;和「从未捕获」分开提示。
            <NoSourceBody
              assertions={allAssertions}
              events={data.events || []}
              message={t(result.hasSources && base ? "code.sourceUnavailable" : "code.noSource")}
              t={t}
            />
          ) : null}
          {result.hasTrace && base ? (
            <LazyArtifact type="trace" src={`${base}/trace.json`} t={t} />
          ) : data.status !== "loading" ? (
            <div className="mt-3 text-xs text-muted">
              {t("trace.enableHint")}
              <a href={t("trace.enableHintUrl")} target="_blank" rel="noreferrer" className="underline">
                {t("trace.enableHintLink")}
              </a>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** errored attempt 的结构化 error 明细(见 docs/feature/reports/view.md「结构化错误」)。结构化
 *  `AttemptError`:operation / code / message + 可选 cause / stack。字段标签是低层技术标识,与终端
 *  `niceeval show` 一样保持英文,不进 view 的 i18n 词典。 */
function ErrorDetailBlock({ error }: { error: NonNullable<ViewResult["error"]> }) {
  const rows: [string, string][] = [
    ["phase", error.phase],
    ["code", error.code],
    ["message", error.message],
  ];
  if (error.cause) rows.push(["cause", error.cause.name ? `${error.cause.name} · ${error.cause.message}` : error.cause.message]);
  const stack = error.stack?.replace(/\n+$/, "") ?? "";
  return (
    <div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </Fragment>
        ))}
      </dl>
      {stack ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted">{stack}</pre>
      ) : null}
    </div>
  );
}

/** attempt 级诊断,按 lifecycle 阶段分组(teardown/cleanup 等,与 verdict 独立;
 *  见 docs/feature/reports/view.md「Attempt 详情」)。 */
function AttemptDiagnostics({ diagnostics }: { diagnostics: NonNullable<ViewResult["diagnostics"]> }) {
  const groups = new Map<string, typeof diagnostics>();
  for (const d of diagnostics) {
    const list = groups.get(d.phase) ?? [];
    groups.set(d.phase, [...list, d]);
  }
  return (
    <div className="mt-3">
      <div className="text-xs font-[640] text-text">diagnostics</div>
      {[...groups.entries()].map(([phase, list]) => (
        <div key={phase} className="mt-1">
          <div className="text-[11px] text-muted">{phase}</div>
          <ul className="mt-0.5 space-y-1 pl-3">
            {list.map((d, i) => (
              <li key={i} className="text-xs">
                <span className="text-muted">
                  {d.level} · {d.code}
                </span>
                <div className="min-w-0 break-words">
                  {d.message}
                  {d.count && d.count > 1 ? ` (${d.count} occurrences)` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const CLOSING_PHASES = new Set(["eval.teardown", "agent.teardown", "sandbox.teardown", "sandbox.suspend", "sandbox.stop"]);

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

/** 统一时间树(见 docs/feature/reports/view.md「Attempt 详情」):`result.json.phases` 的主链
 *  分解与收尾段;每个 phase 可展开 runner 直接观察到的 hook / 命令 / turn(嵌套 children)。 */
function PhaseTimingBlock({ phases }: { phases: NonNullable<ViewResult["phases"]> }) {
  const main = phases.filter((p) => !CLOSING_PHASES.has(p.name));
  const closing = phases.filter((p) => CLOSING_PHASES.has(p.name));
  return (
    <div className="mt-3">
      <div className="text-xs font-[640] text-text">timing</div>
      <ul className="mt-1 space-y-0.5">
        {main.map((p, i) => (
          <TimingRow key={i} name={p.name} durationMs={p.durationMs} failed={p.failed} children_={p.children} />
        ))}
      </ul>
      {closing.length > 0 ? (
        <div className="mt-1">
          <div className="text-[11px] text-muted">teardown (not counted in total)</div>
          <ul className="mt-0.5 space-y-0.5">
            {closing.map((p, i) => (
              <TimingRow key={i} name={p.name} durationMs={p.durationMs} failed={p.failed} children_={p.children} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type TimingChild = NonNullable<NonNullable<ViewResult["phases"]>[number]["children"]>[number];

function TimingRow({
  name,
  durationMs,
  failed,
  children_,
}: {
  name: string;
  durationMs: number;
  failed?: true;
  children_?: TimingChild[];
}) {
  const kids = children_ ?? [];
  const label = (node: TimingChild): string =>
    node.kind === "command" && node.command ? `shell · ${node.command.display}` : node.kind === "turn" ? `turn ${node.label}` : node.label;
  const renderChild = (node: TimingChild, depth: number): React.ReactNode => (
    <li key={node.id} className="text-[11px]" style={{ paddingLeft: `${depth * 12}px` }}>
      <span className="text-muted">{label(node)}</span> {fmtMs(node.durationMs)}
      {node.failed ? <span className="text-bad"> ✗</span> : null}
      {(node.children ?? []).map((c) => renderChild(c, depth + 1))}
    </li>
  );
  return (
    <li className="text-xs">
      <span>{name}</span> <span className="text-muted">{fmtMs(durationMs)}</span>
      {failed ? <span className="text-bad"> ✗</span> : null}
      {kids.length > 0 ? <ul className="mt-0.5 space-y-0.5 pl-3">{kids.map((c) => renderChild(c, 0))}</ul> : null}
    </li>
  );
}

/** usage 与 diff 入口行(见 docs/feature/reports/view.md「Attempt 详情」)。 */
function UsageDiffLine({ result }: { result: ViewResult }) {
  const parts: string[] = [];
  if (result.usage) {
    const tok = result.usage.inputTokens + result.usage.outputTokens;
    parts.push(`usage: ${tok.toLocaleString()} tok${result.usage.costUSD !== undefined ? ` · $${result.usage.costUSD.toFixed(4)}` : ""}`);
  }
  if (result.sandbox) {
    parts.push(`sandbox: ${result.sandbox.provider} · ${result.sandbox.sandboxId}${result.sandbox.kept ? " · kept" : ""}`);
  }
  if (parts.length === 0) return null;
  return <div className="mt-2 text-xs text-muted">{parts.join("   ")}</div>;
}
