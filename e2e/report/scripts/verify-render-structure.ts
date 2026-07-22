// Render-structure & terminal-typography domain (docs/engineering/testing/e2e/report.md §5,
// first three bullets — 结构 / 终端排版 / 双面同源; plan/testing-layer-realignment.md B3).
// Consumes the Evidence object from scripts/evidence.ts; never runs an Experiment itself.
//
// Follows the CLI-black-box convention (README §4.2): every fact below comes from either
// `pnpm exec niceeval show ...` stdout, or a plain fs read of a file evidence.siteExportDir
// already produced (`niceeval view --out`'s static export — a documented CLI output contract,
// not `.niceeval/` internals). No import of niceeval library code, no scanning of `.niceeval/`.
//
// Assertions are string/regex level against real rendered output — report.md says rendering
// assertions "不锁完整 class 列表", no HTML parser needed. Nothing here locks a color VALUE,
// a pixel position, or a full class-attribute snapshot; where a fact varies run to run (a real
// dollar cost, a token count, a "N seconds behind" staleness window), this module extracts the
// SAME fact from both the text and web face and compares them to each other, never to a
// hardcoded literal.
//
// Known fixed facts about this repo's 3 Evals, used as ground truth below (same convention as
// scripts/verify-format.ts hardcoding "get_stock_price"):
//   - deliberate-fail.eval.ts always fails `t.check(1 + 1, equals(3))` — expected 3, received 2.
//   - deliberate-error.eval.ts always throws before any t.send/t.check (phase eval.run, code
//     unexpected-error) — no source capability, 0 assertions.
//   - main's agent is "results-mechanism" (experiments/main.ts's aiSdkAgent name);
//     deliberate-fail's is "results-deliberate-fail"; deliberate-error's is
//     "results-deliberate-error".
//   - produceEvidence() always runs deliberate-fail/deliberate-error BEFORE main, so main's
//     snapshot is always the freshest — deliberate-fail/deliberate-error are always the ones
//     ScopeWarnings flags as stale (exactly 2 flagged experiments, always).
//   - deliberate-fail/deliberate-error never call the real gateway, so they never have cost
//     data — MetricScatter's points="experiment" scatter always has exactly 1 drawable point
//     (main) and reports exactly 2 points missing data.
//
// COVERAGE GAPS — declared here instead of silently claiming coverage (task instructions: list
// what isn't covered rather than pretend it is). None of these were worked around by touching
// scripts/evidence.ts or the shared `.niceeval/` tree; each needs either richer evidence
// (a new Experiment/Eval, decided by a human, not by this module) or a real browser (B4):
//
//   1. MetricScatter's char-mark assignment ORDER (legend key order, series-internal x-ascending
//      order) and `connect`'s line/displacement-summary contract cannot be exercised: this
//      repo's scatter only ever has 1 drawable point (see above), so there's nothing to order
//      and nothing to connect. Would need a 2nd real-gateway Experiment (or a `labels: { line }`
//      declaration making 2+ experiments connect) producing a 2nd point with both cost and
//      pass-rate data.
//   2. `Section`'s box-drawing frame (nested-subheader bar, narrow-width degrade-to-plain) and
//      `Grid`'s column-count planning never render anywhere in the built-in `standard` report
//      (verified: neither <Section> nor <Grid> appears in standard's page tree, and none of
//      `show`'s flag-driven views — bare, --page attempts/traces, --execution/--timing/--diff —
//      use them either). Exercising them needs a custom --report file using these primitives —
//      squarely B5's declared deliverable ("签入代表性 --report 文件"), not this module's.
//   3. `MetricTable` / `MetricMatrix` / `Scoreboard` don't appear in the built-in `standard`
//      report either, so this module's cross-component color-consistency check (bullet 1) only
//      covers the 3 components that DO appear there: `ExperimentList`, `AttemptList`,
//      `MetricScatter`'s legend (all verified consistent for all 3 real agent keys) — not the
//      full component list report.md names. Same "needs a custom --report file" gap as #2.
//   4. `ReportLink.icon`'s inline-SVG-before-label rendering is untestable: the current
//      evidence's report declares no `links` at all (`niceeval.config.ts` has no `--report`,
//      and `window.__NICEEVAL_VIEW_DATA__.report.links` is `[]`) — there is no ReportLink with
//      an icon anywhere in scope. Needs a custom --report file declaring a `links` entry with
//      an `icon`.
//   5. The `view` shell's topbar (NiceEval brand mark, its exact DOM position, and the rendered
//      nav item elements themselves) cannot be verified by string/regex assertion: the static
//      export's `index.html` ships an EMPTY `<div id="root"></div>` — the topbar is built
//      entirely by client-side JS from `window.__NICEEVAL_VIEW_DATA__` after hydration (verified
//      by inspecting the bundle: the brand link, `.topbar`/`.brand`/`.mark` classes and the nav
//      only exist inside the minified JS, never as static markup). This module verifies the
//      DATA CONTRACT that drives the topbar instead (`report.pages` is exactly the
//      navigation !== false pages, in declared order, excluding the attempt-input page) — it
//      does not verify the topbar's actual rendered DOM. That requires a real browser: B4.
//   6. Table's "丢列标注" (explicit dropped-column count, e.g. "(4 more columns not shown)") is
//      real, confirmed behavior (manually verified with a real pty forcing width 40 during this
//      task's development), but is unreachable from this CLI-black-box script: `niceeval show`
//      has no `--width`/env override, and `sh()`'s spawnSync gives no pty, so every invocation
//      here runs at the CLI's non-TTY fallback width (80) — too wide to trigger a drop for this
//      evidence's table shapes (only wrapping triggers at 80, verified and covered below). Width
//      80 is itself a legitimate real scenario (any piped/non-interactive `show` gets it), so
//      this module covers 折行 (wrap) at width 80 but not 丢列 (drop) at narrower widths.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { sh } from "./sh.ts";
import type { Evidence } from "./evidence.ts";

const AGENT = {
  main: "results-mechanism",
  deliberateFail: "results-deliberate-fail",
  deliberateError: "results-deliberate-error",
} as const;

/** AttemptDetail's declared block order (docs/feature/reports/library/attempt-detail.md's full
 * source): Summary, Assessment(Error, then Source-or-Assertions), FixPrompt, Timeline,
 * Diagnostics, Usage, Conversation(only when source doesn't already carry it), Trace, Diff. */
const ATTEMPT_DETAIL_ORDER = [
  "attempt-summary",
  "attempt-error",
  "attempt-source",
  "attempt-assertions",
  "attempt-fix-prompt",
  "attempt-timeline",
  "attempt-diagnostics",
  "attempt-usage",
  "attempt-conversation",
  "attempt-trace",
  "attempt-diff",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `show`'s ScopeSummary line wraps at the CLI's non-TTY fallback width (80) at a point that
 * depends on the real (run-to-run-variable) pass-rate/cost text before it — e.g. "...· 1
 * failed · 1\nerrored · Total cost..." — so a plain multi-word substring check on raw text can
 * spuriously fail depending on exactly where the wrap landed. Collapses all whitespace runs
 * (including the wrap's newline) to a single space before checking containment. */
function looseIncludes(text: string, phrase: string): boolean {
  return text.replace(/\s+/g, " ").includes(phrase);
}

function decodeHtmlEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function readSiteFile(evidence: Evidence, ...parts: string[]): string {
  return readFileSync(join(evidence.siteExportDir, ...parts), "utf8");
}

function attemptHtml(evidence: Evidence, locator: string): string {
  return readSiteFile(evidence, "attempt", `${locator}.html`);
}

/** attempt/<locator>.html carries both locales as sibling `data-nre-locale` wrapper divs;
 * slices to just the "en" copy since block order/presence is locale-independent. */
function englishLocaleSlice(html: string): string {
  const start = html.indexOf('data-nre-locale="en"');
  const end = html.indexOf('data-nre-locale="zh-CN"');
  assert.ok(start >= 0 && end > start, "attempt HTML is missing the expected en/zh-CN locale wrapper divs");
  return html.slice(start, end);
}

function attemptBlockOrder(evidence: Evidence, locator: string): string[] {
  const en = englishLocaleSlice(attemptHtml(evidence, locator));
  const blocks: string[] = [];
  const re = /class="nre nre-(attempt-[a-z-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(en))) blocks.push(m[1]!);
  return blocks;
}

function assertSubsequenceOfCanonicalOrder(present: string[], context: string): void {
  let lastIdx = -1;
  for (const block of present) {
    const idx = ATTEMPT_DETAIL_ORDER.indexOf(block);
    assert.ok(idx >= 0, `${context}: rendered block "${block}" isn't in AttemptDetail's canonical block set`);
    assert.ok(idx > lastIdx, `${context}: block "${block}" rendered out of AttemptDetail's declared order (docs/feature/reports/library/attempt-detail.md), full order: ${present.join(" -> ")}`);
    lastIdx = idx;
  }
}

function extractTemplate(indexHtml: string, templateId: string): string {
  const m = indexHtml.match(new RegExp(`<template id="${templateId}">([\\s\\S]*?)</template>`));
  assert.ok(m, `index.html has no <template id="${templateId}">`);
  return m![1]!;
}

/** Minimal East-Asian-width table — only needs to cover the CJK text this repo's built-in
 * chrome actually renders via NICEEVAL_LANG=zh-CN, not a general Unicode-EAW implementation.
 * Deliberately reimplemented here rather than importing niceeval/report's own `stringWidth`:
 * this module stays CLI-black-box (README §4.2), so it never imports niceeval library code —
 * this is an independent check of the CLI's real rendered output, not the same code re-run. */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
      (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK Radicals .. Yi Radicals (covers CJK Unified Ideographs)
      (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
      (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
      (cp >= 0xffe0 && cp <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

// ---------------------------------------------------------------------------
// 结构 (1/3): AttemptDetail block presence/order/zero-output, default-open <details>,
// expected/received text, locator links + drill-down commands.
// ---------------------------------------------------------------------------

async function verifyAttemptDetailStructure(evidence: Evidence): Promise<void> {
  const mainLocator = evidence.main.attempts[0]!.locator;
  const failLocator = evidence.deliberateFail.attempt.locator;
  const errorLocator = evidence.deliberateError.attempt.locator;

  // --- Passed attempt (main): source capability true (real send/tool-call happened) -> Summary,
  //     Source, Timeline, Usage render; nothing else has evidence.
  const mainBlocks = attemptBlockOrder(evidence, mainLocator);
  assertSubsequenceOfCanonicalOrder(mainBlocks, `attempt/${mainLocator}.html (passed)`);
  for (const must of ["attempt-summary", "attempt-source", "attempt-timeline", "attempt-usage"]) {
    assert.ok(mainBlocks.includes(must), `passed attempt ${mainLocator} is missing "${must}"`);
  }
  for (const mustNot of ["attempt-error", "attempt-assertions", "attempt-fix-prompt", "attempt-diagnostics", "attempt-conversation", "attempt-trace", "attempt-diff"]) {
    assert.ok(!mainBlocks.includes(mustNot), `passed attempt ${mainLocator} unexpectedly rendered "${mustNot}" — zero-evidence components must produce zero output, not an empty placeholder block (report.md 结构条)`);
  }

  // --- Failed attempt (deliberate-fail): 1 gate assertion WITH source capability -> AttemptSource
  //     renders it (AttemptError is for exceptions, not assertion failures, so it stays empty).
  const failBlocks = attemptBlockOrder(evidence, failLocator);
  assertSubsequenceOfCanonicalOrder(failBlocks, `attempt/${failLocator}.html (failed)`);
  for (const must of ["attempt-summary", "attempt-source", "attempt-fix-prompt", "attempt-timeline", "attempt-usage"]) {
    assert.ok(failBlocks.includes(must), `failed attempt ${failLocator} is missing "${must}"`);
  }
  for (const mustNot of ["attempt-error", "attempt-assertions", "attempt-diagnostics", "attempt-conversation", "attempt-trace", "attempt-diff"]) {
    assert.ok(!failBlocks.includes(mustNot), `failed attempt ${failLocator} unexpectedly rendered "${mustNot}"`);
  }

  // --- Errored attempt (deliberate-error): threw before any turn -> no source capability AND 0
  //     assertions, so AttemptAssessment's fallback (AttemptAssertions) is itself empty — NEITHER
  //     attempt-source NOR attempt-assertions renders; AttemptError (the structured exception) does.
  const errorBlocks = attemptBlockOrder(evidence, errorLocator);
  assertSubsequenceOfCanonicalOrder(errorBlocks, `attempt/${errorLocator}.html (errored)`);
  for (const must of ["attempt-summary", "attempt-error", "attempt-fix-prompt", "attempt-timeline", "attempt-usage"]) {
    assert.ok(errorBlocks.includes(must), `errored attempt ${errorLocator} is missing "${must}"`);
  }
  for (const mustNot of ["attempt-source", "attempt-assertions", "attempt-diagnostics", "attempt-conversation", "attempt-trace", "attempt-diff"]) {
    assert.ok(!errorBlocks.includes(mustNot), `errored attempt ${errorLocator} unexpectedly rendered "${mustNot}"`);
  }

  // --- Default-open <details>, expected/received text, badge/name: deliberate-fail's one gate
  //     assertion is a deterministic, fixed fact (equals(1+1, 3) always fails the same way).
  const failHtml = attemptHtml(evidence, failLocator);
  assert.ok(
    /<details class="nre-source-line nre-tone-bad" open="">/.test(failHtml),
    `${failLocator}'s failing source line should default-open (docs/feature/reports/library/attempt-detail.md「AttemptSource web 面视觉规范」: 首个失败或警告行默认展开)`,
  );
  assert.ok(failHtml.includes("expected: 3") && failHtml.includes("received: 2"), `${failLocator} web face is missing the expected/received text for its equals(3) assertion`);
  assert.ok(failHtml.includes('<span class="nre-assertion-badge">failed</span>'), `${failLocator} web face is missing the failed assertion badge`);
  assert.ok(failHtml.includes('<span class="nre-assertion-name">equals(3)</span>'), `${failLocator} web face is missing the assertion name`);

  // --- Structured error fields for the errored attempt (deliberate-error.eval.ts's fixed throw).
  const errorHtml = attemptHtml(evidence, errorLocator);
  assert.ok(errorHtml.includes("<dt>phase</dt><dd>eval.run</dd>"), `${errorLocator} web face is missing the structured error's phase field`);
  assert.ok(errorHtml.includes("<dt>code</dt><dd>unexpected-error</dd>"), `${errorLocator} web face is missing the structured error's code field`);
  assert.ok(errorHtml.includes("deliberate error for e2e contract testing"), `${errorLocator} web face is missing the error message`);

  // --- Locator links: both the report page's ExperimentList and the traces page's
  //     TraceWaterfall link every real attempt to its detail document.
  const indexHtml = readSiteFile(evidence, "index.html");
  for (const locator of [mainLocator, evidence.main.attempts[1]!.locator, failLocator, errorLocator]) {
    const href = `attempt/${locator.replace("@", "%40")}.html`;
    assert.ok(indexHtml.includes(`href="${href}"`), `index.html has no attempt link for ${locator} (expected href="${href}")`);
  }

  // --- Drill-down commands: show's own text face carries copyable evidence commands next to
  //     the facts they explain, not just raw locators.
  const root = evidence.resultsRoot;
  const showFailBare = sh(`pnpm exec niceeval show ${failLocator} --results ${root}`);
  assert.ok(showFailBare.includes(`niceeval show ${failLocator} --source`), `show ${failLocator}'s bare overview is missing the --source drill-down command`);
  assert.ok(showFailBare.includes(`niceeval show ${failLocator} --timing`), `show ${failLocator}'s bare overview is missing the --timing drill-down command`);
  assert.ok(showFailBare.includes("expected: 3") && showFailBare.includes("received: 2"), `show ${failLocator}'s bare overview is missing expected/received text`);

  const showErrorBare = sh(`pnpm exec niceeval show ${errorLocator} --results ${root}`);
  assert.ok(showErrorBare.includes("phase: eval.run"), `show ${errorLocator}'s bare overview is missing the error's phase`);
  assert.ok(showErrorBare.includes("unexpected-error"), `show ${errorLocator}'s bare overview is missing the error's code`);

  const tracesText = sh(`pnpm exec niceeval show --results ${root} --page traces`);
  for (const locator of [mainLocator, failLocator, errorLocator]) {
    assert.ok(tracesText.includes(`niceeval show ${locator} --timing`), `traces page text is missing the --timing drill-down command for ${locator}`);
  }
}

// ---------------------------------------------------------------------------
// 结构 (2/3): ScopeWarnings block (counts, default open/closed), PoweredBy/HeroCard brand link,
// and the view-shell navigation DATA contract (see COVERAGE GAP #5 for what this doesn't cover).
// ---------------------------------------------------------------------------

async function verifyScopeWarningsBrandAndNavigation(evidence: Evidence): Promise<void> {
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-report-en");

  // --- ScopeWarnings: deliberate-fail/deliberate-error are ALWAYS the 2 flagged experiments
  //     (produceEvidence() always runs them before main, so main is always freshest).
  assert.ok(reportTpl.includes('<summary class="nre-warnings-summary">2 experiments flagged</summary>'), 'ScopeWarnings summary should read exactly "2 experiments flagged"');
  assert.ok(/<details class="nre-warnings">(?!\s*open)/.test(reportTpl), "ScopeWarnings' outer <details> should be collapsed by default (no open attribute)");
  const innerOpenCount = (reportTpl.match(/<details class="nre-warning-details" open="">/g) ?? []).length;
  assert.equal(innerOpenCount, 2, `both per-experiment warning groups should default-open (total warnings = 2 <= 3 threshold); found ${innerOpenCount} open inner <details>`);

  // --- CopyFixPrompt: deliberate-fail + deliberate-error are always the 2 failures (main always
  //     passes both real-gateway attempts).
  assert.ok(reportTpl.includes('<summary class="nre-copy-fix-prompt-summary">Fix prompt · 2 failures</summary>'), 'CopyFixPrompt summary should read "Fix prompt · 2 failures"');

  // --- PoweredBy/HeroCard brand link: fixed href with utm params, rel="noopener" WITHOUT
  //     noreferrer, present on every navigable page in every locale (web 恒含).
  const brandLinkRe = /<a href="https:\/\/niceeval\.com\/\?utm_source=report&amp;utm_medium=powered-by" target="_blank" rel="noopener">Powered by NiceEval<\/a>/;
  for (const pageId of ["report", "attempts", "traces"]) {
    for (const locale of ["en", "zh-CN"]) {
      const tpl = extractTemplate(indexHtml, `niceeval-report-${pageId}-${locale}`);
      assert.ok(brandLinkRe.test(tpl), `${pageId}/${locale} template is missing the exact PoweredBy/HeroCard brand link (href with utm_source=report&utm_medium=powered-by, rel="noopener")`);
      assert.ok(!tpl.includes("noreferrer"), `${pageId}/${locale} template's brand link rel must not include noreferrer`);
    }
  }

  // attempt detail documents have no Hero (standardAttemptPage's content is bare
  // <AttemptDetail/>) -> the brand link's actual anchor must be ABSENT there, even though the
  // shared stylesheet's unused .nre-powered-by CSS rule is still bundled into every document.
  for (const locator of [evidence.main.attempts[0]!.locator, evidence.deliberateFail.attempt.locator, evidence.deliberateError.attempt.locator]) {
    const html = attemptHtml(evidence, locator);
    assert.ok(!html.includes("utm_medium=powered-by"), `attempt/${locator}.html unexpectedly contains a rendered PoweredBy link — standardAttemptPage has no Hero`);
  }

  // text face: PoweredBy is web-only, zero text output on every page/flag show renders.
  const root = evidence.resultsRoot;
  const textOutputs = [
    sh(`pnpm exec niceeval show --results ${root}`),
    sh(`pnpm exec niceeval show --results ${root} --page attempts`),
    sh(`pnpm exec niceeval show --results ${root} --page traces`),
    sh(`pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --results ${root}`),
    sh(`pnpm exec niceeval show ${evidence.deliberateFail.attempt.locator} --source --results ${root}`),
  ];
  for (const text of textOutputs) {
    assert.ok(!text.includes("Powered by") && !text.includes("niceeval.com"), "show's text face must never render the PoweredBy brand line (report.md: web 恒含、text 零输出)");
  }

  // --- Navigation DATA contract (see COVERAGE GAP #5: this checks the data feeding the topbar,
  //     not the topbar's own rendered DOM, which only exists after client-side hydration).
  const dataMatch = indexHtml.match(/window\.__NICEEVAL_VIEW_DATA__ = (\{[\s\S]*?\});\s*<\/script>/);
  assert.ok(dataMatch, "index.html is missing the window.__NICEEVAL_VIEW_DATA__ script the client shell hydrates navigation from");
  const viewData = JSON.parse(dataMatch![1]!) as { report: { pages: Array<{ id: string }>; initialPageId: string } };
  assert.deepEqual(
    viewData.report.pages.map((p) => p.id),
    ["report", "attempts", "traces"],
    "view data's page list should be exactly the standard report's navigation !== false pages, in declared order, excluding the attempt-input page (report.md 结构条: 导航项与顺序等于报告定义中 navigation !== false 的页,不多不少)",
  );
  assert.equal(viewData.report.initialPageId, "report", "view data's initial page should be the first navigable page");
}

// ---------------------------------------------------------------------------
// 结构 (3/3): cross-component color-class consistency (colorClassForKey / seriesClassForKey).
// ---------------------------------------------------------------------------

function coloredKeyClass(templateHtml: string, spanClassPrefix: string, key: string): string | undefined {
  const m = templateHtml.match(new RegExp(`class="${escapeRegExp(spanClassPrefix)} nre-key (nre-c\\d)">${escapeRegExp(key)}<`));
  return m?.[1];
}

async function verifyColorConsistency(evidence: Evidence): Promise<void> {
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-report-en");
  const attemptsTpl = extractTemplate(indexHtml, "niceeval-report-attempts-en");

  // ExperimentList (report page) vs AttemptList (attempts page): both key on the same "agent"
  // dimension, for all 3 real agents in scope.
  for (const agent of [AGENT.main, AGENT.deliberateFail, AGENT.deliberateError]) {
    const expColor = coloredKeyClass(reportTpl, "nre-experiment-agent", agent);
    const attColor = coloredKeyClass(attemptsTpl, "nre-attempt-agent", agent);
    assert.ok(expColor, `ExperimentList (report page) has no colored key for agent "${agent}"`);
    assert.ok(attColor, `AttemptList (attempts page) has no colored key for agent "${agent}"`);
    assert.equal(expColor, attColor, `agent "${agent}" gets different color classes in ExperimentList (${expColor}) vs AttemptList (${attColor}) — colorClassForKey must be stable across components regardless of which one renders it (report.md 结构条)`);
  }

  // MetricScatter's legend: only "main"/results-mechanism is ever drawable (see module header —
  // deliberate-fail/error never have cost data), but that's still a real cross-component pair.
  const scatterColor = coloredKeyClass(reportTpl, "nre-legend-key", AGENT.main);
  assert.ok(scatterColor, `MetricScatter legend has no colored key for agent "${AGENT.main}"`);
  assert.equal(scatterColor, coloredKeyClass(reportTpl, "nre-experiment-agent", AGENT.main), `agent "${AGENT.main}" gets a different color in MetricScatter's legend than in ExperimentList`);
}

// ---------------------------------------------------------------------------
// 结构 + 终端排版: MetricScatter — axis direction (web, SVG ticks), connect/legend consistency
// (web), and the char-coordinate chart's marker + legend + hint text (text face).
// ---------------------------------------------------------------------------

function extractAxisTicks(scatterHtml: string, axisClass: "nre-scatter-axis-x" | "nre-scatter-axis-y"): Array<{ pos: number; value: number }> {
  const g = scatterHtml.match(new RegExp(`<g class="nre-scatter-axis ${axisClass}">([\\s\\S]*?)</g>`));
  assert.ok(g, `MetricScatter is missing the ${axisClass} tick group`);
  const posAttrIndex = axisClass === "nre-scatter-axis-x" ? 1 : 2;
  const tickRe = /<text class="nre-scatter-tick" x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>([^<]+)<\/text>/g;
  const ticks: Array<{ pos: number; value: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tickRe.exec(g![1]!))) {
    const pos = Number(m[posAttrIndex]);
    const value = Number(m[3]!.replace(/[^0-9.-]/g, ""));
    assert.ok(Number.isFinite(pos) && Number.isFinite(value), `couldn't parse scatter tick: ${m[0]}`);
    ticks.push({ pos, value });
  }
  assert.ok(ticks.length >= 2, `${axisClass} should have at least 2 ticks, found ${ticks.length}`);
  return ticks;
}

function assertValueDecreasesAsPositionIncreases(ticks: Array<{ pos: number; value: number }>, context: string): void {
  const sorted = [...ticks].sort((a, b) => a.pos - b.pos);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i]!.value < sorted[i - 1]!.value, `${context}: tick values should strictly decrease as pixel position increases, got ${JSON.stringify(sorted)}`);
  }
}

async function verifyMetricScatterStructure(evidence: Evidence): Promise<void> {
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-report-en");
  const figureMatch = reportTpl.match(/<figure class="nre nre-metric-scatter">([\s\S]*?)<\/figure>/);
  assert.ok(figureMatch, "report page is missing the MetricScatter figure");
  const scatter = figureMatch![1]!;

  // --- Axis direction follows `better` (docs/feature/reports/library/metrics.md: costUSD
  //     better=lower, endToEndPassRate better=higher). Ticks' real dollar/percent VALUES vary
  //     run to run — this asserts the DIRECTION rule, not any specific number.
  assertValueDecreasesAsPositionIncreases(extractAxisTicks(scatter, "nre-scatter-axis-x"), "cost axis (better=lower, further right = cheaper)");
  assertValueDecreasesAsPositionIncreases(extractAxisTicks(scatter, "nre-scatter-axis-y"), "pass-rate axis (better=higher, SVG y grows downward, so further down = worse)");
  assert.ok(scatter.includes("better → upper right"), 'MetricScatter should show the "better -> upper right" hint (both axes declare `better`)');

  // --- Missing-data count: deliberate-fail/deliberate-error never have cost data (fixed fact,
  //     see module header), so this is always exactly 2 regardless of the real dollar amounts.
  assert.ok(scatter.includes("2 points missing data"), "MetricScatter should report exactly 2 points missing data");

  // --- connect/legend consistency: no experiment declares a `line` label, so
  //     ExperimentComparison's default series is "agent" with connect=false — no <polyline>.
  assert.ok(!/<polyline/.test(scatter), "MetricScatter should draw no <polyline> when connect is off (default; report.md 结构条: connect 折线与图例的一致性)");

  // See module header COVERAGE GAP #1: with only 1 drawable point, marker-assignment ORDER
  // across multiple points/series and connect's displacement summary can't be exercised here.
}

// ---------------------------------------------------------------------------
// 终端排版: Table 折行 (width 80, the only width this CLI-black-box script can reach — see
// COVERAGE GAP #6 for 丢列标注), CJK 显示宽度口径, and the char-coordinate chart's text face.
// ---------------------------------------------------------------------------

async function verifyTerminalTypography(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;

  // --- Table 折行: at the CLI's non-TTY fallback width (80), ExperimentList's widest cells wrap
  //     onto continuation lines instead of being silently truncated or overflowing the width.
  //     (Only the Table's OWN rows are width-clamped this way — free-form lines elsewhere in the
  //     same output, like ScopeWarnings messages or the scatter legend, are printed unclamped;
  //     this repo's real deliberate-error/-fail warning messages run past 200 columns.)
  const showReport = sh(`pnpm exec niceeval show --results ${root}`);
  // Match only actual padded Table lines: the header ("Exp. ...") or a row that still has
  // "results-" (the wrapped start of the Agent column) on it. This excludes the UNPADDED
  // per-experiment eval/attempt breakdown headings further down the same output, which are
  // bare experiment ids on their own line (e.g. a lone "deliberate-error") — not Table rows.
  const experimentTableRows = showReport.split("\n").filter((l) => /^Exp\./.test(l) || (/^(main|delibera)/.test(l) && l.includes("results-")));
  assert.ok(experimentTableRows.length >= 4, `expected at least 4 ExperimentList table lines (header + 3 rows) in width-80 output, found ${experimentTableRows.length}`);
  for (const line of experimentTableRows) {
    assert.equal(line.length, 80, `ExperimentList table row should be padded to exactly the 80-column width, got ${line.length}: ${JSON.stringify(line)}`);
  }
  // Which cell wraps is content-length-sensitive (the 80-column budget is shared across all 8
  // columns and reallocated based on every cell's actual width, including the real, run-to-run-
  // variable duration/tokens/cost text) — sometimes it's the Agent column, sometimes not, so
  // asserting a SPECIFIC cell always wraps turned out flaky during this task's development.
  // What IS deterministic regardless of that reallocation: "deliberate-error"/"deliberate-fail"
  // are fixed 17/16-char eval ids that can never fit next to "main" (4 chars) in the same
  // fixed-width Experiment column, so they always wrap, leaving "te-error"/"te-fail" as the
  // FIRST token of a continuation line (not just present as a substring somewhere — that
  // substring also occurs mid-sentence inside the un-wrapped ScopeWarnings message text, which
  // isn't evidence of Table wrapping at all).
  for (const row of experimentTableRows) {
    assert.ok(!row.includes("deliberate-error") && !row.includes("deliberate-fail"), `ExperimentList row should never fit "deliberate-error"/"deliberate-fail" contiguously in an 80-column Experiment column: ${JSON.stringify(row)}`);
  }
  assert.ok(showReport.split("\n").some((l) => l.trimStart().startsWith("te-error")), 'expected a continuation line starting with "te-error" (deliberate-error\'s wrapped Experiment-column fragment) in width-80 output');
  assert.ok(showReport.split("\n").some((l) => l.trimStart().startsWith("te-fail")), 'expected a continuation line starting with "te-fail" (deliberate-fail\'s wrapped Experiment-column fragment) in width-80 output');

  // --- CJK 显示宽度口径: NICEEVAL_LANG=zh-CN renders built-in chrome text in Chinese, giving the
  //     "Model" column real 2-column-wide CJK content ("默认", the no-model-declared label) in the
  //     SAME column as the ASCII "deepseek" fragment (deliberate-fail/error use no explicit
  //     model). If padding used raw character count instead of display width for the CJK cell,
  //     the two rows' column-2 TARGET display width (content display width + raw padding chars)
  //     would come out different; this asserts they're equal across all 3 rows.
  // Rows are identified by POSITION, not by matching verdict text ("1 错误"/"1 通过"/"1 失败")
  // alongside them: the Results cell can itself wrap onto a continuation line in some runs
  // (observed during this task's development — real duration/token/cost text length shifts the
  // shared 80-column budget), which would silently drop a text-based match. Row order is
  // pass-rate-descending with ties broken by experiment id ascending (docs/feature/reports/
  // library/metric-views.md「组件级 sort 是稳定排序,同值时仍以 key 收口」) — main(100%) first,
  // then deliberate-error before deliberate-fail (both 0%, "deliberate-error" < "deliberate-fail"
  // lexicographically) — confirmed stable across multiple real runs during development.
  const zhOutput = sh(`NICEEVAL_LANG=zh-CN pnpm exec niceeval show --results ${root}`);
  const zhLines = zhOutput.split("\n");
  const zhTableRows = zhLines.filter((l) => /^(main|delibera)/.test(l) && l.includes("results-"));
  assert.equal(zhTableRows.length, 3, `expected exactly 3 ExperimentList rows (main, deliberate-error, deliberate-fail) in zh-CN width-80 output, found ${zhTableRows.length}:\n${JSON.stringify(zhTableRows)}`);
  const [mainRow, errorRow, failRow] = zhTableRows;

  const columnTwoTargetWidth = (line: string): number => {
    const lead = /^(\S+)(\s+)/.exec(line);
    assert.ok(lead, `row has no leading Experiment-column token: ${JSON.stringify(line)}`);
    const col2Start = lead![0].length;
    const col3Start = line.indexOf("results-");
    assert.ok(col3Start > col2Start, `couldn't find the Agent column's start ("results-") in row: ${JSON.stringify(line)}`);
    const cell = line.slice(col2Start, col3Start).trimEnd();
    const paddingRawChars = col3Start - col2Start - cell.length;
    return displayWidth(cell) + paddingRawChars;
  };

  const widths = [mainRow!, errorRow!, failRow!].map(columnTwoTargetWidth);
  assert.equal(widths[0], widths[1], `zh-CN Model column's target display width should match between the ASCII "deepseek" row and the CJK "默认" row (got ${JSON.stringify(widths)}) — CJK must count as 2 display columns, not 1 (docs/feature/reports/library/layout.md「量测」)`);
  assert.equal(widths[1], widths[2], `zh-CN Model column's target display width should be consistent across both CJK rows (got ${JSON.stringify(widths)})`);

  // --- MetricScatter char-coordinate chart (text face): marker + legend + hint + missing-count.
  //     Single drawable point only (see module header) — nothing to order, nothing to connect.
  assert.ok(/results-mechanism\s+A\s+main/.test(showReport), 'MetricScatter\'s text legend should read "results-mechanism  A main" (single drawable point, marker A)');
  assert.ok(showReport.includes("better → upper right"), 'MetricScatter\'s text face should show the "better -> upper right" hint');
  assert.ok(showReport.includes("2 points missing data"), "MetricScatter's text face should report exactly 2 points missing data");
}

// ---------------------------------------------------------------------------
// 双面同源: text (show) and web (exported HTML) show the same parsed finals, coverage, verdict
// composition and warnings — compares extracted FACTS, never full-line layout strings.
// ---------------------------------------------------------------------------

function extractWebWarningMessage(reportTpl: string, experimentId: string): string {
  const m = reportTpl.match(new RegExp(`<span class="nre-warning-title">${escapeRegExp(experimentId)}</span>[\\s\\S]*?<li class="nre-warning" data-kind="[^"]*">([^<]+)</li>`));
  assert.ok(m, `couldn't find a web ScopeWarnings message for experiment "${experimentId}"`);
  return decodeHtmlEntities(m![1]!);
}

function extractTextWarningMessage(showText: string, experimentId: string): string {
  const m = showText.match(new RegExp(`^!\\s+(verdicts for "${escapeRegExp(experimentId)}"[^\\n]*)$`, "m"));
  assert.ok(m, `couldn't find a text-face ScopeWarnings message for experiment "${experimentId}"`);
  return m![1]!;
}

function extractMainRowFromText(showText: string): { tokens: string; cost: string; passRate: string } {
  const line = showText.split("\n").find((l) => l.trimStart().startsWith("main") && l.includes("tokens"));
  assert.ok(line, "couldn't find main's ExperimentList row (line 1) in text output");
  const tokens = /(\d+(?:\.\d+)?) tokens/.exec(line!);
  const cost = /(\$\d+(?:\.\d+)?)/.exec(line!);
  const passRate = /(\d+(?:\.\d+)?)%/.exec(line!);
  assert.ok(tokens && cost && passRate, `couldn't parse main's text row: ${JSON.stringify(line)}`);
  return { tokens: tokens![1]!, cost: cost![1]!, passRate: passRate![1]! };
}

function extractMainRowFromWeb(reportTpl: string): { tokens: string; cost: string; passRate: string } {
  const entryRe = /<details class="nre-experiment-entry">([\s\S]*?)<\/details>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(reportTpl))) {
    if (!m[1]!.includes('data-sort-value="main"')) continue;
    const block = m[1]!;
    const tokens = /(\d+(?:\.\d+)?) tokens/.exec(block);
    const cost = /(\$\d+(?:\.\d+)?)/.exec(block);
    const passRate = /title="[^"]*attempts measured">(\d+(?:\.\d+)?)%</.exec(block);
    assert.ok(tokens && cost && passRate, "couldn't parse main's web ExperimentList entry");
    return { tokens: tokens![1]!, cost: cost![1]!, passRate: passRate![1]! };
  }
  throw new Error('couldn\'t find main\'s <details class="nre-experiment-entry"> block in web output');
}

async function verifyDualRenderParity(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;
  const showText = sh(`pnpm exec niceeval show --results ${root}`);
  const indexHtml = readSiteFile(evidence, "index.html");
  const reportTpl = extractTemplate(indexHtml, "niceeval-report-report-en");

  // --- Scope-level pass rate: same underlying ScopeSummaryData, extracted from both faces.
  const textPassRate = /Pass rate (\d+(?:\.\d+)?)%/.exec(showText);
  const webPassRate = /<dt>Pass rate<\/dt>\s*<dd>[\s\S]*?<span class="nre-value" title="[^"]*attempts measured">(\d+(?:\.\d+)?)%<\/span>/.exec(reportTpl);
  assert.ok(textPassRate && webPassRate, "couldn't extract the scope-level pass rate from both faces");
  assert.equal(textPassRate![1], webPassRate![1], `text pass rate (${textPassRate![1]}%) should equal web ScopeSummary pass rate (${webPassRate![1]}%)`);

  // --- Counts: experiments / evals / attempts, identical on both faces. The text-face
  //     ScopeSummary line wraps at an unpredictable point (depends on the real, run-to-run-
  //     variable pass-rate/cost text before it), so containment checks tolerate a wrap landing
  //     between any two words (looseIncludes collapses the wrap's newline to a space).
  assert.ok(looseIncludes(showText, "3 experiments"), 'text is missing "3 experiments"');
  assert.ok(/<dt>Experiments<\/dt>\s*<dd>3<\/dd>/.test(reportTpl), "web ScopeSummary is missing Experiments=3");
  assert.ok(looseIncludes(showText, "3 evals"), 'text is missing "3 evals"');
  assert.ok(/<dt>Evals<\/dt>\s*<dd>3<\/dd>/.test(reportTpl), "web ScopeSummary is missing Evals=3");
  assert.ok(looseIncludes(showText, "4 attempts"), 'text is missing "4 attempts"');
  assert.ok(/<dt>Attempts<\/dt>\s*<dd>4<\/dd>/.test(reportTpl), "web ScopeSummary is missing Attempts=4");

  // --- Verdict composition: eval-level tally (1 passed / 1 failed / 1 errored — main's 2 tool-call
  //     attempts fold to 1 passed eval), identical on both faces.
  for (const label of ["passed", "failed", "errored"] as const) {
    assert.ok(looseIncludes(showText, `1 ${label}`), `text is missing "1 ${label}" in the verdict tally`);
    assert.ok(reportTpl.includes(`nre-verdict-pill nre-verdict-${label}">1 ${label}<`), `web ScopeSummary is missing the "1 ${label}" verdict pill`);
  }

  // --- Per-experiment metrics for "main": tokens/cost/pass-rate are real, run-to-run-variable
  //     gateway numbers — extracted from both faces and compared to EACH OTHER, never hardcoded.
  const textRow = extractMainRowFromText(showText);
  const webRow = extractMainRowFromWeb(reportTpl);
  assert.equal(textRow.tokens, webRow.tokens, `main's token count differs between text (${textRow.tokens}) and web (${webRow.tokens})`);
  assert.equal(textRow.cost, webRow.cost, `main's cost differs between text (${textRow.cost}) and web (${webRow.cost})`);
  assert.equal(textRow.passRate, webRow.passRate, `main's pass rate differs between text (${textRow.passRate}%) and web (${webRow.passRate}%)`);

  // --- ScopeWarnings message identity: the exact three-part message text (Results 三段式),
  //     including its dynamic "N seconds behind" / timestamp content, must be the SAME string on
  //     both faces — compared to each other, not to a hardcoded literal.
  for (const experimentId of [evidence.deliberateFail.id, evidence.deliberateError.id]) {
    const webMsg = extractWebWarningMessage(reportTpl, experimentId);
    const textMsg = extractTextWarningMessage(showText, experimentId);
    assert.equal(textMsg, webMsg, `ScopeWarnings message for "${experimentId}" differs between text and web faces`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function verifyRenderStructure(evidence: Evidence): Promise<void> {
  await verifyAttemptDetailStructure(evidence);
  await verifyScopeWarningsBrandAndNavigation(evidence);
  await verifyColorConsistency(evidence);
  await verifyMetricScatterStructure(evidence);
  await verifyTerminalTypography(evidence);
  await verifyDualRenderParity(evidence);
}
