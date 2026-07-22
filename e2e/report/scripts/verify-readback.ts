// Read-face CLI behavior domain (docs/engineering/testing/e2e/report.md §4 — plan/testing-layer-realignment.md
// B2): show / view's observable behavior against real Results — selection & narrowing, history &
// multi-page, evidence facets, Scope warnings, export & local server. Consumes the Evidence object
// from scripts/evidence.ts, same as scripts/verify-format.ts, but this module is NOT exempt from the
// CLI-black-box rule (README §4.2) — unlike verify-format.ts (exempt for point 1: format IS what it
// tests), this domain never imports niceeval library code to read results and never scans
// `.niceeval/` innards. Every assertion below is either:
//   - `pnpm exec niceeval ...` stdout/exit-code (the only sanctioned read path), or
//   - plain fs reads of a CLI OUTPUT directory (`view --out`'s site directory, or Evidence's
//     already-produced siteExportDir) — a documented, stable CLI output contract
//     (docs/feature/reports/view.md「静态导出」), not `.niceeval/` internals, or
//   - a real HTTP fetch against a `niceeval view` local server this module itself spawns and kills.
//
// Two of report.md §4's five bullets (partial-coverage / stale-snapshot / unreadable-snapshot Scope
// warnings, and "no phases" timing) don't occur naturally in this repo's 3-Experiment evidence
// without disturbing other domains' assertions on the shared resultsRoot. For those this module
// hand-writes a minimal, isolated Results-format fixture (buildScopeWarningsFixture below) — plain
// JSON literals following docs/feature/results/architecture.md's schema, written to its own scratch
// directory, read back only through `niceeval show/view --results <scratch>` — never touching
// Evidence.resultsRoot (docs/engineering/testing/e2e/report.md's B2 task, 「重要操作提示」#2).
//
// "历史与多页" needs a second real snapshot the shared Evidence doesn't produce (produceEvidence()
// only runs each Experiment once), so this module makes two extra real `niceeval exp main` calls: one
// `--force` (small real gateway cost, sanctioned by the B2 task) to get a second snapshot, and one
// without `--force` (free — carry-forward reuse) to prove `--history`'s cross-snapshot dedup actually
// collapses duplicates instead of just merging everything it sees.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import assert from "node:assert/strict";
import { InfraError } from "./evidence.ts";
import { sh } from "./sh.ts";
import type { Evidence } from "./evidence.ts";

const PROVIDER_FAULT_RE = /errored.*(429|5\d\d|ECONNREFUSED|ETIMEDOUT)/i;

/** Same real-gateway-call convention as scripts/evidence.ts's shExpectZero — the one extra real call
 * this module makes (the --force re-run in verifyHistoryAndPages) gets the same infra/regression split. */
function shExpectZero(cmd: string): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  if (exit === 0) return res.stdout;
  const combined = `${res.stdout}\n${res.stderr}`;
  if (PROVIDER_FAULT_RE.test(combined)) {
    throw new InfraError(`${cmd} exited ${exit} with a provider-side fault visible in --output ci text:\n${combined.slice(-3000)}`);
  }
  throw new Error(`${cmd}\nexited ${exit}, expected 0. stdout/stderr tail:\n${combined.slice(-3000)}`);
}

/** For commands we expect to fail with a specific message — returns {stdout,stderr,combined,status}
 * instead of throwing, since the assertion IS "it failed this particular way". niceeval's CLI writes
 * usage/no-match errors to stderr and normal report output to stdout (empirically verified per call
 * site below) — `combined` is what callers should match against unless they care which stream. */
function shRaw(cmd: string): { stdout: string; stderr: string; combined: string; status: number } {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { stdout, stderr, combined: `${stdout}\n${stderr}`, status: res.status ?? -1 };
}

// ---------------------------------------------------------------------------
// Local `niceeval view` server lifecycle — this module's own responsibility
// (docs/engineering/testing/e2e/README.md「被测服务由仓库的 scripts/e2e.ts 启动和清理」's spirit,
// applied here at the verify-domain level since this repo has no long-lived service of its own).
// ---------------------------------------------------------------------------

interface ViewServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

/** Spawns `pnpm exec niceeval view --no-open <extraArgs>`, waits for the printed URL (= readiness),
 * and returns a handle with a `stop()` that terminates the process group. Rejects if no URL appears
 * within 20s or the process exits first (e.g. the zero-readable-results case — callers that WANT
 * that outcome use `expectServerDoesNotStart` instead). */
function startViewServer(extraArgs: string[]): Promise<ViewServer> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("pnpm", ["exec", "niceeval", "view", "--no-open", ...extraArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let buffered = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* already gone */ }
      reject(new Error(`niceeval view --no-open ${extraArgs.join(" ")} printed no URL within 20s. Output so far:\n${buffered}`));
    }, 20_000);

    const onData = (chunk: Buffer) => {
      buffered += chunk.toString();
      const match = buffered.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        const baseUrl = `http://127.0.0.1:${match[1]}`;
        resolvePromise({
          baseUrl,
          stop: () =>
            new Promise<void>((res) => {
              proc.once("exit", () => res());
              try { process.kill(-proc.pid!, "SIGTERM"); } catch { res(); }
              setTimeout(() => { try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* already gone */ } }, 3000);
            }),
        });
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`niceeval view --no-open ${extraArgs.join(" ")} exited (code ${code}) before printing a URL. Output:\n${buffered}`));
    });
  });
}

/** For the zero-readable-results case: asserts the process exits nonzero WITHOUT ever printing a
 * server URL, within a short window — the "view 不启动 server" half of the Scope-warnings bullet. */
function expectServerDoesNotStart(extraArgs: string[]): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("pnpm", ["exec", "niceeval", "view", "--no-open", ...extraArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let buffered = "";
    const timer = setTimeout(() => {
      try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* already gone */ }
      reject(new Error(`expected niceeval view --no-open ${extraArgs.join(" ")} to exit immediately (zero readable results), but it was still running (and printed no URL) after 10s:\n${buffered}`));
    }, 10_000);
    const onData = (chunk: Buffer) => { buffered += chunk.toString(); };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (/http:\/\/127\.0\.0\.1:\d+\//.test(buffered)) {
        reject(new Error(`niceeval view --no-open ${extraArgs.join(" ")} printed a server URL despite zero readable results:\n${buffered}`));
        return;
      }
      resolvePromise({ exitCode: code, output: buffered });
    });
    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Hand-written minimal Results-format fixture (docs/feature/results/architecture.md's schema) —
// used to demonstrate Scope-warning kinds and "no phases → unavailable" that don't occur naturally
// in this repo's real evidence. `schemaVersion: 8` is the current format version documented in
// architecture.md「版本与升级设计」; this is a hand-authored fixture, not a value read off
// `.niceeval/` (this module never reads `.niceeval/` — see file header).
// ---------------------------------------------------------------------------

const FIXTURE_SCHEMA_VERSION = 8;

function fixtureSnapshotMeta(over: Record<string, unknown>) {
  return {
    format: "niceeval.results",
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    producer: { name: "niceeval-e2e-readback-fixture", version: "0.0.0" },
    agent: "fixture-agent",
    ...over,
  };
}

function fixtureResult(over: Record<string, unknown>) {
  return { attempt: 0, durationMs: 1, assertions: [], ...over };
}

function writeJson(dir: string, filename: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify(value, null, 2), "utf8");
}

interface ScopeWarningsFixture {
  /** Root with 3 experiments: scratch-partial (partial-coverage), scratch-stale (stale-snapshot),
   * scratch-broken (unreadable-snapshot, malformed JSON) — plus 2 readable experiments so
   * "单个坏快照不阻塞其余" has something to prove. */
  root: string;
  /** A second, separate root containing ONLY the malformed snapshot — the "零可读结果" case. */
  onlyBrokenRoot: string;
  brokenDir: string;
}

function buildScopeWarningsFixture(scratchRoot: string): ScopeWarningsFixture {
  const root = join(scratchRoot, "scope-warnings");

  // scratch-partial: single snapshot, knownEvalIds declares 2 evals but only 1 ever ran
  // → partial-coverage (covered 1/2). Its startedAt is the latest in this fixture root so it
  // doesn't ALSO pick up stale-snapshot — keeps this a clean single-kind example.
  const partialDir = join(root, "scratch-partial", "2026-01-10T00-00-00-000Z-bbbb");
  writeJson(partialDir, "snapshot.json", fixtureSnapshotMeta({
    experimentId: "scratch-partial",
    startedAt: "2026-01-10T00:00:00.000Z",
    completedAt: "2026-01-10T00:00:01.000Z",
    knownEvalIds: ["eval-a", "eval-ghost"],
  }));
  // No `phases` field — also this module's fixture for "落盘无 phases 时如实显示 unavailable".
  writeJson(join(partialDir, "eval-a", "a0"), "result.json", fixtureResult({ id: "eval-a", verdict: "passed" }));

  // scratch-stale: single OLD snapshot, 8 days behind scratch-partial's → stale-snapshot only
  // (only one snapshot ever for this experiment, so no partial-coverage of its own).
  const staleDir = join(root, "scratch-stale", "2026-01-02T00-00-00-000Z-cccc");
  writeJson(staleDir, "snapshot.json", fixtureSnapshotMeta({
    experimentId: "scratch-stale",
    startedAt: "2026-01-02T00:00:00.000Z",
    completedAt: "2026-01-02T00:00:01.000Z",
  }));
  writeJson(join(staleDir, "eval-c", "a0"), "result.json", fixtureResult({ id: "eval-c", verdict: "passed" }));

  // scratch-broken: malformed snapshot.json → unreadable-snapshot (reason "malformed"). Zero
  // readable snapshots for this experiment id — it must not appear as an experiment at all.
  const brokenDir = join(root, "scratch-broken", "2026-01-03T00-00-00-000Z-dddd");
  mkdirSync(brokenDir, { recursive: true });
  writeFileSync(join(brokenDir, "snapshot.json"), "{ this is not valid json", "utf8");
  writeJson(join(brokenDir, "eval-d", "a0"), "result.json", fixtureResult({ id: "eval-d", verdict: "passed" }));

  // Separate root: ONLY the malformed snapshot — the "零可读结果" case (show non-zero, view no server).
  const onlyBrokenRoot = join(scratchRoot, "only-broken");
  const onlyBrokenDir = join(onlyBrokenRoot, "broken-exp", "2026-01-03T00-00-00-000Z-eeee");
  mkdirSync(onlyBrokenDir, { recursive: true });
  writeFileSync(join(onlyBrokenDir, "snapshot.json"), "{ also not valid json", "utf8");
  writeJson(join(onlyBrokenDir, "eval-e", "a0"), "result.json", fixtureResult({ id: "eval-e", verdict: "passed" }));

  return { root, onlyBrokenRoot, brokenDir };
}

// ---------------------------------------------------------------------------
// Small parsing helpers over CLI stdout — never over `.niceeval/`.
// ---------------------------------------------------------------------------

/** `--history` row lines start with a sortable "YYYY-MM-DDTHH-MM" timestamp column. */
function historyRows(output: string): { timestamp: string; locator: string }[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\s/.test(l))
    .map((l) => ({ timestamp: l.match(/^(\S+)/)![1]!, locator: l.match(/@\S+/)![0]! }));
}

function assertAscending(rows: { timestamp: string }[], context: string): void {
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1]!.timestamp <= rows[i]!.timestamp, `${context}: row ${i} (${rows[i]!.timestamp}) is out of ascending order after row ${i - 1} (${rows[i - 1]!.timestamp})`);
  }
}

/** Recursively checks whether any file named `name` exists under `dir` — used only against CLI
 * OUTPUT directories (a `view --out` export), never `.niceeval/`. */
function containsFileNamed(dir: string, name: string): boolean {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (containsFileNamed(full, name)) return true;
    } else if (entry.name === name) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Bullet 1: 选择与收窄
// ---------------------------------------------------------------------------

async function verifySelectionAndNarrowing(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;

  // Positional eval id prefix narrows the report to that eval alone.
  const toolCallOnly = sh(`pnpm exec niceeval show tool-call --results ${root}`);
  assert.ok(toolCallOnly.includes("tool-call"), "show tool-call should mention the tool-call eval");
  assert.ok(!toolCallOnly.includes("deliberate"), "show tool-call narrowed the wrong way — deliberate-* leaked into a tool-call-only view");

  // Positional arg uses RAW (裸) prefix matching, not path-segment matching: "deliberate" is a
  // partial word inside both "deliberate-fail" and "deliberate-error" (no "/" involved) and still
  // matches both — the contrast with --exp's path-segment rule below is the point of this bullet.
  const bothDeliberate = sh(`pnpm exec niceeval show deliberate --results ${root} --history`);
  assert.ok(bothDeliberate.includes("deliberate-fail"), "raw-prefix 'deliberate' should match deliberate-fail");
  assert.ok(bothDeliberate.includes("deliberate-error"), "raw-prefix 'deliberate' should match deliberate-error");
  assert.ok(!bothDeliberate.includes("tool-call"), "raw-prefix 'deliberate' should not also match tool-call/main");

  // --exp matches by PATH SEGMENT: an exact segment matches...
  const expExact = sh(`pnpm exec niceeval show --exp deliberate-fail --results ${root}`);
  assert.ok(expExact.includes("1 experiment"), "--exp deliberate-fail should narrow to exactly 1 experiment");
  assert.ok(!expExact.includes("tool-call"), "--exp deliberate-fail leaked tool-call/main into scope");

  // ...but a partial word that ISN'T a full segment does NOT match, unlike the positional case above.
  const expPartial = shRaw(`pnpm exec niceeval show --exp deliberate --results ${root}`);
  assert.notEqual(expPartial.status, 0, "--exp deliberate (partial segment) should fail to match anything");
  assert.ok(
    expPartial.combined.includes("No experiment matched --exp deliberate"),
    `--exp deliberate should report no match (path-segment semantics differ from the positional arg's raw-prefix rule); got: ${expPartial.combined}`,
  );
  assert.ok(expPartial.combined.includes("deliberate-error") && expPartial.combined.includes("deliberate-fail") && expPartial.combined.includes("main"), "no-match message should list the candidate experiment ids");

  const expMain = sh(`pnpm exec niceeval show --exp main --results ${root}`);
  assert.ok(expMain.includes("1 experiment"), "--exp main should narrow to exactly 1 experiment");
  assert.ok(!expMain.includes("deliberate"), "--exp main leaked deliberate-* into scope");

  // --results explicit flag (same value as default here, but exercises the flag itself).
  const explicitResults = sh(`pnpm exec niceeval show tool-call --results ${root}`);
  assert.ok(explicitResults.includes("tool-call"), "--results <root> should behave like the default root");

  // A locator missing its leading "@" is treated as an eval id prefix, matches nothing, and the
  // command reports so explicitly with the candidate eval ids listed (docs/feature/reports/show.md
  // 「无匹配与不可读结果」) — not a silent empty result.
  const bareBody = evidence.main.attempts[0]!.locator.slice(1); // strip leading "@"
  const noMatch = shRaw(`pnpm exec niceeval show ${bareBody} --results ${root}`);
  assert.notEqual(noMatch.status, 0, `show ${bareBody} (no @) should fail — it's not a valid eval id prefix`);
  assert.ok(noMatch.combined.includes(`No results matched: ${bareBody}`), `expected an explicit no-match message; got: ${noMatch.combined}`);
  assert.ok(noMatch.combined.includes("tool-call"), "no-match message should list tool-call as a candidate eval with results");

  // Same selection rules on the view host: --exp / positional narrowing changes the exported
  // artifact/ subset identically to what show reported above.
  const scratchRoot = mkdtempSync(join(tmpdir(), "niceeval-readback-view-select-"));
  try {
    const mainOut = join(scratchRoot, "main-only");
    sh(`pnpm exec niceeval view --exp main --results ${root} --out ${mainOut} --no-open`);
    assert.ok(existsSync(join(mainOut, "artifact", "main")), "view --exp main --out should export artifact/main");
    assert.ok(!existsSync(join(mainOut, "artifact", "deliberate-fail")), "view --exp main --out should NOT export artifact/deliberate-fail");
    assert.ok(!existsSync(join(mainOut, "artifact", "deliberate-error")), "view --exp main --out should NOT export artifact/deliberate-error");

    const deliberateOut = join(scratchRoot, "deliberate-only");
    sh(`pnpm exec niceeval view deliberate --results ${root} --out ${deliberateOut} --no-open`);
    assert.ok(existsSync(join(deliberateOut, "artifact", "deliberate-fail")), "view deliberate --out (raw prefix) should export artifact/deliberate-fail");
    assert.ok(existsSync(join(deliberateOut, "artifact", "deliberate-error")), "view deliberate --out (raw prefix) should export artifact/deliberate-error");
    assert.ok(!existsSync(join(deliberateOut, "artifact", "main")), "view deliberate --out should NOT export artifact/main");

    const expBad = shRaw(`pnpm exec niceeval view --exp deliberate --results ${root} --out ${join(scratchRoot, "bad")} --no-open`);
    assert.notEqual(expBad.status, 0, "view --exp deliberate (partial segment) should fail the same way show did");
    assert.ok(expBad.combined.includes("No experiment matched --exp deliberate"), "view's --exp error message should match show's");
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Bullet 2: 历史与多页
// ---------------------------------------------------------------------------

async function verifyHistoryAndPages(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;

  // Baseline: Evidence's single real snapshot has 2 tool-call attempts.
  const baselineHistory = sh(`pnpm exec niceeval show tool-call --results ${root} --history`);
  const baselineRows = historyRows(baselineHistory);
  assert.equal(baselineRows.length, evidence.main.attempts.length, "baseline --history row count should match Evidence.main.attempts");
  assertAscending(baselineRows, "baseline --history");

  // Real second snapshot of the same Experiment (small real gateway cost — sanctioned for this
  // specific check, since Evidence itself only ever produces one snapshot per Experiment).
  shExpectZero(`pnpm exec niceeval exp main --force --output ci`);

  const afterForce = sh(`pnpm exec niceeval show tool-call --results ${root} --history`);
  const afterForceRows = historyRows(afterForce);
  assert.equal(afterForceRows.length, baselineRows.length + 2, "a --force re-run of main should add 2 new distinct attempts to --history (runs:2)");
  assertAscending(afterForceRows, "--history after --force re-run");
  for (const original of baselineRows) {
    assert.ok(afterForceRows.some((r) => r.locator === original.locator), `--history after re-run lost the original attempt ${original.locator} — cross-snapshot merge dropped history instead of appending`);
  }

  // A free reuse run (no --force): unchanged eval/agent/model means the fingerprint matches and the
  // 2 attempts from the just-created snapshot get carried forward into a third snapshot untouched.
  const reuseOutput = shExpectZero(`pnpm exec niceeval exp main --output ci`);
  assert.ok(/reused=2/.test(reuseOutput), `expected the no-force re-run to carry forward 2 attempts (reused=2); got: ${reuseOutput}`);

  const afterReuse = sh(`pnpm exec niceeval show tool-call --results ${root} --history`);
  const afterReuseRows = historyRows(afterReuse);
  assert.equal(
    afterReuseRows.length,
    afterForceRows.length,
    `--history should DEDUP the carried-forward attempts by identity key (experimentId, evalId, attempt, startedAt) — a 3rd snapshot with the same 2 attempts carried forward must not double the row count (got ${afterReuseRows.length}, expected ${afterForceRows.length})`,
  );
  assertAscending(afterReuseRows, "--history after carry-forward reuse run");

  // --history and --report are mutually exclusive (both take over the main output).
  const mutex = shRaw(`pnpm exec niceeval show --history --report reports/does-not-exist.tsx --results ${root}`);
  assert.notEqual(mutex.status, 0, "--history --report should be a usage error");
  assert.ok(/mutually exclusive/i.test(mutex.combined), `expected a mutual-exclusion message; got: ${mutex.combined}`);

  // Multi-page: show renders the built-in "report" page and appends a reproducible index of the
  // other navigable pages (attempts, traces) — commands carry --results AND positional args forward.
  // Use the "deliberate" prefix (matches 2 evals) rather than "tool-call" (matches exactly 1 eval):
  // narrowing to a single eval switches the report page into a focused single-eval drill-down view
  // that has no page index at all — a real, distinct display mode, not a page-index bug.
  const bareShow = sh(`pnpm exec niceeval show deliberate --results ${root}`);
  assert.ok(bareShow.includes("Other pages:"), "show should append a page index for the built-in multi-page report");
  assert.ok(bareShow.includes(`niceeval show deliberate --results ${root} --page attempts`), "page index command should reproduce positional args + --results + --page");
  assert.ok(bareShow.includes(`niceeval show deliberate --results ${root} --page traces`), "page index should list the traces page too");
  assert.ok(!/--page report\b/.test(bareShow), "the page index should not list 'report' as an OTHER page — it's the one currently rendered");

  const attemptsPage = sh(`pnpm exec niceeval show deliberate --results ${root} --page attempts`);
  assert.ok(attemptsPage.includes("Other pages:"), "--page attempts should append an index of the OTHER pages");
  assert.ok(attemptsPage.includes(`niceeval show deliberate --results ${root} --page report`), "index from the attempts page should offer report");
  assert.ok(attemptsPage.includes(`niceeval show deliberate --results ${root} --page traces`), "index from the attempts page should offer traces");
  assert.ok(!/--page attempts\b/.test(attemptsPage.split("Other pages:")[1] ?? ""), "the attempts page's own index should not re-list itself");

  const tracesPage = sh(`pnpm exec niceeval show --results ${root} --page traces`);
  assert.ok(tracesPage.includes("Other pages:"), "--page traces should append an index of the OTHER pages");
  assert.ok(tracesPage.includes("--page report"), "index from the traces page should offer report");
  assert.ok(tracesPage.includes("--page attempts"), "index from the traces page should offer attempts");

  // Unknown page id: usage error naming the available pages, no silent fallback.
  const badPage = shRaw(`pnpm exec niceeval show --results ${root} --page bogus`);
  assert.notEqual(badPage.status, 0, "--page bogus should be a usage error");
  assert.ok(
    badPage.combined.includes('page "bogus" not found') && badPage.combined.includes("report, attempts, traces"),
    `expected a "page not found" error listing the built-in page ids; got: ${badPage.combined}`,
  );
}

// ---------------------------------------------------------------------------
// Bullet 3: 证据切面
// ---------------------------------------------------------------------------

async function verifyEvidenceFacets(evidence: Evidence, fixture: ScopeWarningsFixture): Promise<void> {
  const root = evidence.resultsRoot;
  const passedLocator = evidence.main.attempts[0]!.locator;
  const failedLocator = evidence.deliberateFail.attempt.locator;

  // --source: eval source annotated with the send/assertion markers, on both a passed and a failed
  // real attempt.
  const passedSource = sh(`pnpm exec niceeval show ${passedLocator} --source --results ${root}`);
  assert.ok(passedSource.includes("evals/tool-call.eval.ts"), "--source should name the eval source file");
  assert.ok(/\S+\s*·\s*completed\s*·/.test(passedSource), `--source should annotate the t.send() line with the turn's label + status + duration; got:\n${passedSource}`);

  const failedSource = sh(`pnpm exec niceeval show ${failedLocator} --source --results ${root}`);
  assert.ok(failedSource.includes("evals/deliberate-fail.eval.ts"), "--source should name deliberate-fail's eval source file");
  assert.ok(failedSource.includes("expected 3") && failedSource.includes("received 2"), "--source should annotate the failing assertion with expected/received");

  // --execution works on real evidence (full node coverage already asserted in verify-format.ts's
  // README §4.3 check); here we assert the "no trace collected" honesty this repo's 3 Experiments
  // (none configure tracing/OTel) is positioned to prove — the doc's "落盘无 phases 时如实显示
  // unavailable,不猜" bullet, applied to the trace subtree (see the phase-less fixture check below
  // for the literal "no phases" half of that same honesty contract).
  const execution = sh(`pnpm exec niceeval show ${passedLocator} --execution --results ${root}`);
  assert.ok(execution.includes("timing unavailable"), "--execution should say timing is unavailable when no OTel trace was collected");
  assert.ok(execution.includes("OTel trace was not collected"), "--execution's unavailable annotation should say why, not guess a value");

  // --diff works on real evidence (in-process aiSdkAgent attempts still carry a diff.json with no
  // windows — "no changes" is a real, distinct outcome from "diff unavailable").
  const diff = sh(`pnpm exec niceeval show ${passedLocator} --diff --results ${root}`);
  assert.ok(diff.includes("no file changes by the agent"), `--diff should report no agent-attributed changes; got: ${diff}`);
  assert.ok(diff.includes("diff.json"), "--diff's no-changes message should still point at the full diff.json for verification");

  // --timing: bounded diagnostic tree. On this repo's tiny real timing trees (a handful of nodes,
  // well under the 80-node budget) the bounded and full projections must be byte-identical — this
  // is timing.md's documented "Case 1: 小树" contract, not a weaker substitute for it.
  const timingSummary = sh(`pnpm exec niceeval show ${passedLocator} --timing --results ${root}`);
  const timingFull = sh(`pnpm exec niceeval show ${passedLocator} --timing=full --results ${root}`);
  assert.equal(timingSummary, timingFull, "for a small timing tree (< 80 nodes), --timing and --timing=full must render identically (timing.md Case 1)");
  assert.ok(timingSummary.includes("eval.run"), "--timing should show the eval.run phase from real runner phase data");

  // --timing only accepts summary|full — anything else is a usage error, not a silent fallback.
  const badTiming = shRaw(`pnpm exec niceeval show ${passedLocator} --timing=bogus --results ${root}`);
  assert.notEqual(badTiming.status, 0, "--timing=bogus should be a usage error");
  assert.ok(badTiming.combined.includes('"summary"'), `expected --timing's usage error to name the accepted values; got: ${badTiming.combined}`);

  // Literal "no phases" honesty: a hand-fixture attempt with no `phases` field at all must show
  // "phase timing unavailable", never a guessed/derived total, in both --timing and --timing=full.
  const fixtureLocatorLine = sh(`pnpm exec niceeval show eval-a --results ${fixture.root} --history`);
  const fixtureLocator = fixtureLocatorLine.match(/@\S+/)?.[0];
  assert.ok(fixtureLocator, `could not find eval-a's locator in fixture --history output: ${fixtureLocatorLine}`);
  const noPhasesSummary = sh(`pnpm exec niceeval show ${fixtureLocator} --timing --results ${fixture.root}`);
  const noPhasesFull = sh(`pnpm exec niceeval show ${fixtureLocator} --timing=full --results ${fixture.root}`);
  assert.ok(noPhasesSummary.includes("phase timing unavailable"), `expected "phase timing unavailable" for a fixture attempt with no phases; got: ${noPhasesSummary}`);
  assert.ok(noPhasesFull.includes("phase timing unavailable"), `--timing=full should also say phase timing unavailable, not derive a fake tree; got: ${noPhasesFull}`);
}

// ---------------------------------------------------------------------------
// Bullet 4: Scope warnings
// ---------------------------------------------------------------------------

async function verifyScopeWarnings(fixture: ScopeWarningsFixture): Promise<void> {
  // show: all three warning kinds present, and the two readable experiments still render fully
  // despite the third being unreadable — "单个坏快照不阻塞其余".
  const board = sh(`pnpm exec niceeval show --results ${fixture.root}`);
  assert.ok(board.includes("scratch-partial") && board.includes("coverage 1/2"), `expected a partial-coverage warning for scratch-partial (1/2); got:\n${board}`);
  assert.ok(board.includes("1 of 2 evals"), `partial-coverage message should state "1 of 2 evals"; got:\n${board}`);
  assert.ok(board.includes("scratch-stale") && board.includes("8 days behind"), `expected a stale-snapshot warning for scratch-stale (8 days behind); got:\n${board}`);
  assert.ok(board.includes("snapshot") && board.includes("skipped") && board.includes("malformed"), `expected an unreadable-snapshot warning mentioning the malformed skip; got:\n${board}`);
  assert.ok(board.includes(fixture.brokenDir), "unreadable-snapshot warning should name the actual skipped directory");
  // Despite one broken experiment, the other two still fully render (not blocked):
  assert.ok(board.includes("2 experiments"), `scratch-partial and scratch-stale should both still render even with scratch-broken unreadable; got:\n${board}`);
  assert.ok(board.includes("Pass rate 100%"), "the 2 readable experiments' data should compute normally, unaffected by the unreadable third");

  // view: the same three warning kinds surface in the static export (same site pipeline as the
  // local server — README §4.2/report.md §4 exempt this repo from re-spinning a server for every
  // check; point 5 below verifies server ≡ --out byte-for-byte once).
  const outDir = mkdtempSync(join(tmpdir(), "niceeval-readback-warnings-out-"));
  try {
    sh(`pnpm exec niceeval view --results ${fixture.root} --out ${outDir} --no-open`);
    const indexHtml = readFileSync(join(outDir, "index.html"), "utf8");
    assert.ok(indexHtml.includes("coverage 1/2"), "view --out's index.html should carry the same partial-coverage warning as show");
    assert.ok(indexHtml.includes("8 days"), "view --out's index.html should carry the same stale-snapshot warning as show");
    assert.ok(indexHtml.includes("malformed"), "view --out's index.html should carry the same unreadable-snapshot warning as show");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  // Zero readable results: show exits non-zero with an explicit "no results" message (not a blank
  // success), and view refuses to export or serve anything.
  const emptyShow = shRaw(`pnpm exec niceeval show --results ${fixture.onlyBrokenRoot}`);
  assert.notEqual(emptyShow.status, 0, "show over a results root with zero readable snapshots should exit non-zero");
  assert.ok(emptyShow.combined.includes("No results found"), `expected an explicit "no results" message; got: ${emptyShow.combined}`);
  assert.ok(emptyShow.combined.includes("malformed"), "the zero-readable message should still surface why the one snapshot present was skipped");

  const emptyOutDir = join(mkdtempSync(join(tmpdir(), "niceeval-readback-empty-out-")), "site");
  const emptyOutResult = shRaw(`pnpm exec niceeval view --results ${fixture.onlyBrokenRoot} --out ${emptyOutDir} --no-open`);
  assert.notEqual(emptyOutResult.status, 0, "view --out over zero readable results should exit non-zero");
  assert.ok(!existsSync(emptyOutDir), "view --out over zero readable results must not create an empty site directory");

  const serverAttempt = await expectServerDoesNotStart(["--results", fixture.onlyBrokenRoot]);
  assert.notEqual(serverAttempt.exitCode, 0, "view over zero readable results should exit non-zero instead of starting a server");
}

// ---------------------------------------------------------------------------
// Bullet 5: 导出与 server
// ---------------------------------------------------------------------------

async function verifyExportAndServer(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;
  const mainAttemptRelDir = relative(root, evidence.main.attempts[0]!.attemptDir);
  const deliberateFailRelDir = relative(root, evidence.deliberateFail.attempt.attemptDir);

  // --- Full-root local server: byte-for-byte identity with Evidence's already-produced --out export
  //     (view.md: "本地模式与静态导出共用同一条站点管线... 同一输入下同一路径逐字节一致"). Same
  //     server also carries the o11y-never-served and sources.json-dereferenced checks, since it's
  //     already up and serving the same full, unnarrowed scope as siteExportDir.
  const fullServer = await startViewServer(["--results", root]);
  try {
    const indexResp = await fetch(`${fullServer.baseUrl}/`);
    assert.equal(indexResp.status, 200, "server should serve / with 200");
    const indexBody = await indexResp.text();
    const exportedIndex = readFileSync(join(evidence.siteExportDir, "index.html"), "utf8");
    assert.equal(indexBody, exportedIndex, "local server's / response must be byte-identical to the --out export's index.html for the same input");

    const attemptResp = await fetch(`${fullServer.baseUrl}/attempt/${evidence.main.attempts[0]!.locator}.html`);
    assert.equal(attemptResp.status, 200, "server should serve the attempt detail page with 200");
    const attemptBody = await attemptResp.text();
    const exportedAttempt = readFileSync(join(evidence.siteExportDir, "attempt", `${evidence.main.attempts[0]!.locator}.html`), "utf8");
    assert.equal(attemptBody, exportedAttempt, "local server's attempt page must be byte-identical to the --out export's for the same locator");

    // sources.json out-of-band (server response) is dereferenced {path, content}[], never the
    // on-disk two-tier {path, sha256} reference (memory/attempt-locator-and-source-dedup).
    const sourcesResp = await fetch(`${fullServer.baseUrl}/artifact/${mainAttemptRelDir}/sources.json`);
    assert.equal(sourcesResp.status, 200, "server should serve the in-scope attempt's sources.json artifact");
    const sourcesBody = (await sourcesResp.json()) as { path: string; content?: string; sha256?: string }[];
    assert.ok(sourcesBody.length > 0, "sources.json should have at least one entry");
    assert.ok(sourcesBody.every((s) => typeof s.content === "string"), "server-served sources.json entries must carry dereferenced content, not a bare sha256 reference");
    assert.ok(sourcesBody.every((s) => !("sha256" in s)), "server-served sources.json must not leak the on-disk sha256 reference field");

    // Same dereferenced shape in the static export file.
    const exportedSourcesJson = JSON.parse(readFileSync(join(evidence.siteExportDir, "artifact", mainAttemptRelDir, "sources.json"), "utf8")) as { path: string; content?: string }[];
    assert.ok(exportedSourcesJson.every((s) => typeof s.content === "string"), "--out export's sources.json must also be dereferenced {path, content}[]");

    // o11y.json is never served, full root or not — probe the REAL known path for an attempt that
    // does have an on-disk o11y.json.
    const o11yResp = await fetch(`${fullServer.baseUrl}/artifact/${mainAttemptRelDir}/o11y.json`);
    assert.equal(o11yResp.status, 404, "o11y.json must never be served by the local server, even for an in-scope attempt that has one on disk");
  } finally {
    await fullServer.stop();
  }

  // o11y.json is never exported either — walk the entire exported artifact/ tree.
  assert.ok(!containsFileNamed(join(evidence.siteExportDir, "artifact"), "o11y.json"), "no o11y.json should ever appear anywhere under a --out export's artifact/ tree");

  // --- Narrowed export: page Scope AND artifact/ tree narrow together; an out-of-scope attempt's
  //     HTML document isn't generated at all (contrast with the narrowed SERVER below, which still
  //     resolves it — the documented split between the two routes).
  const narrowedOutDir = mkdtempSync(join(tmpdir(), "niceeval-readback-narrowed-out-"));
  try {
    sh(`pnpm exec niceeval view --exp main --results ${root} --out ${narrowedOutDir} --no-open`);
    assert.ok(existsSync(join(narrowedOutDir, "artifact", "main")), "narrowed --out should still export the in-scope experiment's artifact tree");
    assert.ok(!existsSync(join(narrowedOutDir, "artifact", "deliberate-fail")), "narrowed --out must not export the out-of-scope experiment's artifact tree");
    assert.ok(
      !existsSync(join(narrowedOutDir, "attempt", `${evidence.deliberateFail.attempt.locator}.html`)),
      "narrowed --out must not generate an HTML document for an out-of-scope attempt's locator at all",
    );
    assert.ok(
      existsSync(join(narrowedOutDir, "attempt", `${evidence.main.attempts[0]!.locator}.html`)),
      "narrowed --out should still generate the in-scope attempt's HTML document",
    );
  } finally {
    rmSync(narrowedOutDir, { recursive: true, force: true });
  }

  // --- Narrowed local server: the attempt-detail ROUTE resolves against the FULL results root
  //     regardless of --exp (same result-root-wide addressing as `show @<locator>`), but the raw
  //     artifact/ FILE route respects the same --exp narrowing as the page Scope and the --out
  //     export above — two different routes, two different scoping rules, both documented in
  //     view.md's "导出与 server" paragraph.
  const narrowedServer = await startViewServer(["--exp", "main", "--results", root]);
  try {
    const outOfScopeAttemptResp = await fetch(`${narrowedServer.baseUrl}/attempt/${evidence.deliberateFail.attempt.locator}.html`);
    assert.equal(outOfScopeAttemptResp.status, 200, "the attempt-detail route must resolve an out-of-scope locator (full-root addressing) even under --exp main");
    const outOfScopeAttemptBody = await outOfScopeAttemptResp.text();
    assert.ok(outOfScopeAttemptBody.includes("deliberate-fail"), "the resolved out-of-scope attempt page should show its real content");

    const outOfScopeArtifactResp = await fetch(`${narrowedServer.baseUrl}/artifact/${deliberateFailRelDir}/sources.json`);
    assert.equal(outOfScopeArtifactResp.status, 404, "the raw artifact/ file route MUST respect --exp narrowing, unlike the attempt-detail route above");

    const inScopeArtifactResp = await fetch(`${narrowedServer.baseUrl}/artifact/${mainAttemptRelDir}/events.json`);
    assert.equal(inScopeArtifactResp.status, 200, "the raw artifact/ file route should still serve in-scope attempts normally");
  } finally {
    await narrowedServer.stop();
  }

  // --- attempt/<locator>.html is fully readable with no JavaScript: strip every <script> tag and
  //     confirm the real verdict/assertion text is still present in the remaining markup.
  const failedAttemptHtmlPath = join(evidence.siteExportDir, "attempt", `${evidence.deliberateFail.attempt.locator}.html`);
  const failedAttemptHtml = readFileSync(failedAttemptHtmlPath, "utf8");
  const withoutScripts = failedAttemptHtml.replace(/<script[\s\S]*?<\/script>/gi, "");
  assert.ok(withoutScripts.includes("deliberate-fail"), "attempt HTML with all <script> tags stripped should still show the eval id");
  assert.ok(withoutScripts.includes("expected 3") && withoutScripts.includes("received 2"), "attempt HTML with all <script> tags stripped should still show the failing assertion's expected/received values");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function verifyReadback(evidence: Evidence): Promise<void> {
  const scratchRoot = mkdtempSync(join(tmpdir(), "niceeval-readback-fixtures-"));
  try {
    const fixture = buildScopeWarningsFixture(scratchRoot);

    // Order matters: verifyHistoryAndPages is the only section that mutates the shared
    // evidence.resultsRoot (it makes 2 extra real `niceeval exp main` runs to get a second
    // snapshot — see that function's own comment). It must run LAST, after
    // verifyExportAndServer's byte-for-byte comparison against evidence.siteExportDir — that
    // export was produced once by produceEvidence() and would go stale (mismatch a freshly
    // queried server) the moment an extra snapshot lands in evidence.resultsRoot. The other
    // three sections are read-only against evidence.resultsRoot (or use their own isolated
    // fixture/export directories), so their relative order doesn't matter.
    await verifySelectionAndNarrowing(evidence);
    await verifyEvidenceFacets(evidence, fixture);
    await verifyScopeWarnings(fixture);
    await verifyExportAndServer(evidence);
    await verifyHistoryAndPages(evidence);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}
