// 本地结果查看器:读 summary.json,按 experiment 聚合,注入 HTML 模板。

import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { EvalResult, RunSummary, Usage, Verdict } from "../types.ts";

export interface ViewOptions {
  input?: string;
  out?: string;
  port?: number;
}

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

interface LoadedSummary {
  path: string;
  summary: RunSummary;
}

interface LeaderboardRow {
  key: string;
  experimentId?: string;
  experiment?: EvalResult["experiment"];
  group?: string;
  label: string;
  agent: string;
  model?: string;
  runs: number;
  passed: number;
  failed: number;
  scored: number;
  skipped: number;
  passRate: number;
  avgDurationMs: number;
  usage: Usage;
  estimatedCostUSD?: number;
  results: EvalResult[];
}

const VERDICT_ORDER: Record<Verdict, number> = {
  failed: 0,
  scored: 1,
  skipped: 2,
  passed: 3,
};

const TEMPLATE_PLACEHOLDERS = {
  styles: "<!-- __FASTEVALS_STYLES__ -->",
  lastRun: "__FASTEVALS_LAST_RUN__",
  sourceList: "__FASTEVALS_SOURCE_LIST__",
  passRate: "__FASTEVALS_PASS_RATE__",
  resultCount: "__FASTEVALS_RESULT_COUNT__",
  duration: "__FASTEVALS_DURATION__",
  cost: "__FASTEVALS_COST__",
  resultsBody: "<!-- __FASTEVALS_RESULTS_BODY__ -->",
  rowsJson: "__FASTEVALS_ROWS_JSON__",
} as const;

export async function buildView(opts: ViewOptions = {}): Promise<string> {
  const summaries = await loadSummaries(opts.input);
  const out = resolve(opts.out ?? ".fastevals/report.html");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await renderHtml(summaries), "utf-8");
  return out;
}

export async function startViewServer(opts: ViewOptions = {}): Promise<ViewServer> {
  const input = opts.input;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
        return;
      }
      if (url.pathname !== "/") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(await renderHtml(await loadSummaries(input)));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(e instanceof Error ? e.stack ?? e.message : String(e));
    }
  });

  const port = await listen(server, opts.port ?? 0);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      }),
  };
}

async function renderHtml(loaded: LoadedSummary[]): Promise<string> {
  const latest = loaded[0]?.summary;
  const rows = aggregateRows(loaded);
  const totals = summarizeAll(loaded);
  const template = await readViewAsset("template.html");
  const styles = await readViewAsset("styles.css");

  return template
    .replace(TEMPLATE_PLACEHOLDERS.styles, `<style>\n${styles}\n</style>`)
    .replace(TEMPLATE_PLACEHOLDERS.lastRun, escapeHtml(latest ? formatDate(latest.startedAt) : "No runs yet"))
    .replace(
      TEMPLATE_PLACEHOLDERS.sourceList,
      escapeHtml(loaded.slice(0, 6).map((s) => relativeName(s.path)).join(", ") || ".fastevals"),
    )
    .replace(TEMPLATE_PLACEHOLDERS.passRate, formatPercent(totals.passRate))
    .replace(TEMPLATE_PLACEHOLDERS.resultCount, String(totals.results))
    .replace(TEMPLATE_PLACEHOLDERS.duration, formatDuration(totals.durationMs))
    .replace(TEMPLATE_PLACEHOLDERS.cost, formatCost(totals.cost))
    .replace(TEMPLATE_PLACEHOLDERS.resultsBody, rows.length ? renderTable() : renderEmptyState())
    .replace(TEMPLATE_PLACEHOLDERS.rowsJson, JSON.stringify(rows).replace(/</g, "\\u003c"));
}

async function readViewAsset(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf-8");
}

async function listen(server: Server, preferredPort: number): Promise<number> {
  const tryListen = (port: number): Promise<number> =>
    new Promise((resolveListen, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolveListen(typeof address === "object" && address ? address.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });

  if (preferredPort === 0) return tryListen(0);
  for (let port = preferredPort; port < preferredPort + 20; port++) {
    try {
      return await tryListen(port);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    }
  }
  throw new Error(`No available port near ${preferredPort}`);
}

async function loadSummaries(input?: string): Promise<LoadedSummary[]> {
  const target = resolve(input ?? ".fastevals");
  if (!existsSync(target)) return [];
  const s = await stat(target);
  if (s.isFile()) return [{ path: target, summary: await readSummary(target) }];

  const candidates = await findSummaryFiles(target);
  const loaded: LoadedSummary[] = [];
  for (const path of candidates) {
    try {
      loaded.push({ path, summary: await readSummary(path) });
    } catch {
      // Ignore unrelated JSON files under .fastevals.
    }
  }
  loaded.sort((a, b) => b.summary.startedAt.localeCompare(a.summary.startedAt));
  return loaded;
}

async function findSummaryFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const direct = entries.filter((e) => e.isFile() && e.name === "summary.json").map((e) => join(dir, e.name));
  const nested = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => findSummaryFiles(join(dir, e.name))));
  return [...direct, ...nested.flat()];
}

async function readSummary(path: string): Promise<RunSummary> {
  const data = JSON.parse(await readFile(path, "utf-8")) as RunSummary;
  if (!Array.isArray(data.results) || typeof data.startedAt !== "string") {
    throw new Error(`${path} is not a fastevals summary`);
  }
  return data;
}

function renderTable(): string {
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th><button data-sort="experiment">Experiment</button></th>
          <th><button data-sort="model">Model</button></th>
          <th><button data-sort="agent">Agent</button></th>
          <th><button data-sort="avgDurationMs">Avg Duration</button></th>
          <th><button data-sort="passRate">Success Rate</button></th>
          <th><button data-sort="tokens">Tokens</button></th>
          <th><button data-sort="cost">Est. Cost</button></th>
          <th>Verdicts</th>
        </tr>
      </thead>
      <tbody id="results-body"></tbody>
    </table>
  </div>`;
}

function renderEmptyState(): string {
  return `<div class="empty">No summary.json files found. Run <code>fastevals</code> or pass <code>fastevals view path/to/summary.json</code>.</div>`;
}

function aggregateRows(loaded: LoadedSummary[]): LeaderboardRow[] {
  const groups = new Map<string, EvalResult[]>();
  for (const item of loaded) {
    for (const result of item.summary.results) {
      const key = result.experimentId ? `exp|||${result.experimentId}` : `legacy|||${result.agent}|||${result.model ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), result]);
    }
  }

  return Array.from(groups.entries()).map(([key, results]) => {
    const first = results[0]!;
    const experimentId = first.experimentId;
    const cost = sumMaybe(results.map((r) => r.estimatedCostUSD));
    return {
      key,
      experimentId,
      experiment: first.experiment,
      group: experimentGroup(experimentId),
      label: displayExperimentName(experimentId) ?? fallbackExperimentLabel(first),
      agent: first.agent,
      model: first.model,
      runs: results.length,
      passed: results.filter((r) => r.verdict === "passed").length,
      failed: results.filter((r) => r.verdict === "failed").length,
      scored: results.filter((r) => r.verdict === "scored").length,
      skipped: results.filter((r) => r.verdict === "skipped").length,
      passRate: results.length ? results.filter((r) => r.verdict === "passed").length / results.length : 0,
      avgDurationMs: avg(results.map((r) => r.durationMs)),
      usage: sumUsage(results.map((r) => r.usage)),
      estimatedCostUSD: cost,
      results: results
        .slice()
        .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.id.localeCompare(b.id)),
    };
  });
}

function summarizeAll(loaded: LoadedSummary[]) {
  const results = loaded.flatMap((s) => s.summary.results);
  const passed = results.filter((r) => r.verdict === "passed").length;
  return {
    results: results.length,
    passRate: results.length ? passed / results.length : 0,
    durationMs: loaded.reduce((sum, s) => sum + (s.summary.durationMs ?? 0), 0),
    cost: sumMaybe(loaded.map((s) => s.summary.estimatedCostUSD)),
  };
}

function sumUsage(items: Array<Usage | undefined>): Usage {
  return {
    inputTokens: items.reduce((n, u) => n + (u?.inputTokens ?? 0), 0),
    outputTokens: items.reduce((n, u) => n + (u?.outputTokens ?? 0), 0),
    cacheReadTokens: items.reduce((n, u) => n + (u?.cacheReadTokens ?? 0), 0),
    cacheWriteTokens: items.reduce((n, u) => n + (u?.cacheWriteTokens ?? 0), 0),
    requests: items.reduce((n, u) => n + (u?.requests ?? 0), 0),
  };
}

function sumMaybe(items: Array<number | undefined>): number | undefined {
  const known = items.filter((n): n is number => n !== undefined);
  return known.length ? known.reduce((sum, n) => sum + n, 0) : undefined;
}

function avg(items: number[]): number {
  return items.length ? items.reduce((sum, n) => sum + n, 0) / items.length : 0;
}

function displayExperimentName(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.split("/").filter(Boolean).at(-1) ?? id;
}

function experimentGroup(id: string | undefined): string | undefined {
  if (!id || !id.includes("/")) return undefined;
  return id.split("/").slice(0, -1).join("/");
}

function fallbackExperimentLabel(result: EvalResult): string {
  if (result.experiment?.id) return displayExperimentName(result.experiment.id) ?? result.experiment.id;
  if (result.model) return `${result.agent}/${result.model}`;
  return result.agent || "ad hoc run";
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function formatCost(n: number | undefined): string {
  if (n === undefined || n <= 0) return "$0";
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

function relativeName(path: string): string {
  const dir = basename(dirname(path));
  return extname(dir) ? basename(path) : `${dir}/${basename(path)}`;
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}
