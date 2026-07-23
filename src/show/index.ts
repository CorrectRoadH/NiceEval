// niceeval show —— 终端宿主(行为规范:docs/feature/reports/show.md 与分篇;
// 宿主组合语义:docs/feature/reports/architecture.md「Scope 是计算入口」)。
//
// 一次调用 = 范围 × 切片 × 形态(docs/feature/reports/show.md)。范围:eval id 前缀位置参数、
// `@<locator>`(单元素范围)、`--exp`(可重复,>=2 进入对照语义)、`--results`、`--fresh`。
// 切片(每个切片解析成一次报告组件装配,见 architecture.md「show 的切片是组件选择」):
//   无证据 flag 且 --exp < 2   默认榜单(内建报告的 text 面;裸 show / eval 前缀 / 单个 --exp 都落在这里)
//   无证据 flag 且 --exp >= 2  对照矩阵(DeltaTable,接线点见 renderCompareSlice)
//   @<locator> 且无证据 flag   失败诊断首页(当前 report 的 attempt-input page)
//   --source / --execution / --timing / --diff[=路径]   证据切面(宿主本体,不渲染报告槽);
//     接受任意范围,范围含多个 attempt 时按 experimentId、evalId、attempt 序逐 attempt 分节
//     (renderEvidenceSections),单 attempt 范围只是省掉分节
//   --history        执行时间轴(逐 experimentId + evalId 分节),与 --report 互斥
//   --report <文件>  整槽换成用户报告;位置前缀 / --results / --exp 先收窄 Scope 再注入
//   --page <id>      多页报告选页;未命中列出可用页 id 按用法错误退出
//
// 数据全部走 niceeval/results 的读取面(openResults + 合成 Scope + loadAttemptEvidence),
// 不自己爬目录;证据可用性只由 loadAttemptEvidence 在单 Attempt 页面计算。

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  openResults,
  resolveLocator,
  loadAttemptEvidence,
  ATTEMPT_LOCATOR_PREFIX,
  LocatorNotFoundError,
  MalformedLocatorError,
} from "../results/index.ts";
// ReportLoadError must come from the SAME module instance the report runtime is built
// against — `instanceof` is keyed by declaration site, so a raw src copy and the compiled
// dist copy of "the same" class are two different types. The package-owned report runtime
// ships as precompiled ESM (dist/report/**, built by `pnpm run build:report`); all report
// loading/rendering goes through ../report/runtime/host.ts (the shared contact surface).
import { ReportLoadError } from "../../dist/report/runtime/load.js";
import { detectLocale, t } from "../i18n/index.ts";
import { selectCurrentResults, filterExperiments } from "../results/select.ts";
import { evalPrefixPredicate, matchExperimentSelector } from "../shared/aggregate.ts";
import { panelCapabilityOf } from "../report/model/panel.ts";
import { attemptHistory } from "./compose.ts";
import {
  buildHostReportMeta,
  HostReportError,
  loadHostReport,
  renderHostPageText,
  type HostCommandContext,
} from "../report/runtime/host.ts";
import {
  attemptArtifactsPath,
  attemptEvidenceHeader,
  attemptHistoryText,
  diffText,
  evalSourceText,
  executionText,
  otherPagesText,
  timingText,
  skippedRunsText,
} from "./render.ts";
import type { AttemptHandle } from "../results/index.ts";

export interface ShowFlags {
  /** --source:该 attempt 运行时保存的 Eval 源码,断言标回源码行(证据切面)。 */
  source?: boolean;
  /** 该 attempt 的标准执行事件流 + OTel enrichment(证据切面)。 */
  execution?: boolean;
  /** --timing:默认有界诊断投影；full 逐节点展开。boolean 仅供库调用兼容，等价 summary。 */
  timing?: boolean | "summary" | "full";
  /** --diff(文件级摘要)。 */
  diff?: boolean;
  /** --diff=<路径>(单个文件的完整改动;路径必须 = 连写,位置参数永远留给 eval id 前缀)。 */
  diffPath?: string;
  history?: boolean;
  /**
   * --exp(可重复):0/1 个沿用前缀收窄语义(可能匹配多个 experiment);2 个以上进入对照语义——
   * 每个必须恰好解析到一个 experiment,顺序即对照条件顺序、首个是基准
   * (docs/feature/reports/show.md「选择结果范围」)。
   */
  experiment?: string[];
  /** --results:结果根目录(某次快照根或 `copySnapshots` 产物)。 */
  results?: string;
  report?: string;
  /** --page:多页报告选页;未命中按用法错误退出并列出可用页 id。 */
  page?: string;
  /** --fresh:只统计新执行的 attempt(排除携带条目与跨快照拼入的历史执行)。 */
  fresh?: boolean;
}

/** 注入 IO 供测试;默认写 stdout/stderr、宽度取终端列数。 */
export interface ShowIO {
  out?: (text: string) => void;
  err?: (text: string) => void;
  width?: number;
  now?: number;
  /** `Section` 的框线传输能力(docs/feature/reports/library/layout.md「区域框」);省略时按
   *  `process.stdout.isTTY` 与 `NO_COLOR` 探测——测试注入固定值,不依赖真实终端设备。 */
  panelMode?: "boxed" | "plain";
}

/** 真实 CLI 入口的框线传输能力探测:是 TTY 且没有要求朴素输出时才画框。 */
function detectPanelMode(): "boxed" | "plain" {
  return panelCapabilityOf({ isTTY: process.stdout.isTTY, noColor: process.env.NO_COLOR, width: process.stdout.columns }).mode;
}

/** 可预期的用户错误:打一句英文直说问题与下一步,退出码 1,不抛堆栈。 */
class ShowError extends Error {}

function clampWidth(columns: number | undefined): number {
  if (!Number.isFinite(columns) || (columns ?? 0) <= 0) return 80;
  return Math.max(40, Math.min(columns as number, 160));
}

// --report 的装载住在 ../report/runtime/host.ts(两个宿主共用的中性联系面);规范化本身是
// `defineReport` 自己的职责,不在宿主层重复。
export { loadHostReport, localizeText } from "../report/runtime/host.ts";

/**
 * 证据切面(--source/--execution/--timing/--diff)的范围排序:按 experimentId、evalId、
 * attempt 序(docs/feature/reports/show/execution.md「--execution 接受任意范围」)。单元素
 * 范围(`@<locator>`)排序是恒等操作——locator 与范围通用实现走同一条代码路径,不另立
 * 「locator 专属」分支。
 */
export function sortAttemptsForSections(attempts: readonly AttemptHandle[]): AttemptHandle[] {
  return [...attempts].sort(
    (a, b) =>
      a.experimentId.localeCompare(b.experimentId) ||
      a.evalId.localeCompare(b.evalId) ||
      a.result.attempt - b.result.attempt,
  );
}

/**
 * 证据切面的范围通用渲染:对排序后的每个 attempt 装配 flags 选中的区块并拼成一节;范围含
 * 多个 attempt 时天然分节(节头是每节 block 自带的 `attemptEvidenceHeader` 定位行),单
 * attempt 范围只是省掉了分节——两种输入量走同一份实现(docs/feature/reports/show.md
 * 「一次调用 = 范围 × 切片 × 形态」)。
 */
async function renderEvidenceSections(
  attempts: readonly AttemptHandle[],
  flags: Pick<ShowFlags, "source" | "execution" | "timing" | "diff" | "diffPath">,
  cwd: string,
  width: number,
): Promise<string> {
  const ordered = sortAttemptsForSections(attempts);
  const sections: string[] = [];
  for (const attempt of ordered) {
    const attemptEvidence = await loadAttemptEvidence(attempt);
    const header = attemptEvidenceHeader(attemptEvidence);
    const artifactPath = attemptArtifactsPath(attempt, cwd);
    const blocks: string[] = [];
    if (flags.source) blocks.push(evalSourceText(attemptEvidence, { header, artifactPath, width }));
    if (flags.execution) blocks.push(executionText(attemptEvidence, { header, artifactPath, width }));
    if (flags.timing !== undefined && flags.timing !== false) {
      blocks.push(
        timingText(attemptEvidence, { header, artifactPath, width, mode: flags.timing === "full" ? "full" : "summary" }),
      );
    }
    if (flags.diff || flags.diffPath !== undefined) {
      blocks.push(diffText({ header, diff: attemptEvidence.diff, artifactPath, file: flags.diffPath }));
    }
    sections.push(blocks.join("\n\n"));
  }
  return sections.join("\n\n");
}

/**
 * 缺省切片选择表第二行(`--exp` 出现两次以上 → 对照矩阵)的接线点:`DeltaTable` 组件与
 * `deltaTableData` 计算函数由并行节点实现(plan/show-scope-slice-json.md 节点 C1,
 * docs/feature/reports/show/compare.md);本节点只完成范围解析与校验,渲染入口先给诚实的
 * 占位错误,不假装已经装好。DeltaTable 落地后,这个函数体替换成组件装配 + text 面渲染,
 * 调用点(show() 里对 renderCompareSlice 的调用)不用改。
 */
function renderCompareSlice(conditions: readonly string[]): never {
  throw new ShowError(t("cli.show.compareNotWired", { conditions: conditions.join(", "), first: conditions[0] ?? "" }));
}

/**
 * `--exp` 的范围校验(docs/feature/reports/show.md「选择结果范围」):0/1 个沿用前缀收窄
 * (可能匹配多个 experiment,如目录前缀);2 个以上进入对照语义,每个必须恰好解析到一个
 * experiment——零命中按现有的 noExperimentMatch 报,命中多个列出全部候选 id,不猜测意图。
 */
function assertExperimentSelectors(experimentIds: readonly string[], selectors: readonly string[]): void {
  if (selectors.length < 2) return;
  for (const raw of selectors) {
    const selector = raw.replace(/\/+$/, "");
    const matches = matchExperimentSelector(experimentIds, selector);
    if (matches.length === 0) {
      throw new ShowError(t("cli.show.noExperimentMatch", { arg: raw, experiments: experimentIds.join(", ") }));
    }
    if (matches.length > 1) {
      throw new ShowError(t("cli.show.expAmbiguous", { arg: raw, matched: matches.length, candidates: matches.join(", ") }));
    }
  }
}

export async function runShow(
  cwd: string,
  patterns: string[],
  flags: ShowFlags,
  io: ShowIO = {},
): Promise<number> {
  const out = io.out ?? ((text: string) => void process.stdout.write(text));
  const err = io.err ?? ((text: string) => void process.stderr.write(text));
  try {
    await show(cwd, patterns, flags, {
      out,
      err,
      width: clampWidth(io.width ?? process.stdout.columns),
      now: io.now ?? Date.now(),
      panelMode: io.panelMode ?? detectPanelMode(),
    });
    return 0;
  } catch (e) {
    if (e instanceof ShowError || e instanceof ReportLoadError || e instanceof HostReportError) {
      err(e.message.endsWith("\n") ? e.message : `${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

async function show(
  cwd: string,
  patterns: string[],
  flags: ShowFlags,
  io: { out: (s: string) => void; err: (s: string) => void; width: number; now: number; panelMode: "boxed" | "plain" },
): Promise<void> {
  const evidence =
    flags.source === true ||
    flags.execution === true ||
    (flags.timing !== undefined && flags.timing !== false) ||
    flags.diff === true ||
    flags.diffPath !== undefined;

  // 组合语义矩阵(docs/feature/reports/show.md「选择结果范围」):--history 与 --report 互斥,先于任何 IO 报出来。
  if (flags.history && flags.report !== undefined) {
    throw new ShowError(t("cli.show.historyReportConflict"));
  }

  // --page 只在报告槽里有意义:证据切面 / 时间轴与它组合是用法矛盾,先于任何 IO 报出来。
  if (flags.page !== undefined && (evidence || flags.history)) {
    throw new ShowError(
      `--page selects a report page and cannot be combined with ${flags.history ? "--history" : "evidence flags"}.\n`,
    );
  }

  // `@<locator>` 与重复 `--exp` 互斥:locator 已经唯一确定了 experiment,再给对照条件没有
  // 可执行的语义(docs/feature/reports/show.md「选择结果范围」),先于任何 IO 报出来。
  const expSelectors = flags.experiment ?? [];
  const locatorArgForMutex = patterns.find((p) => p.startsWith(ATTEMPT_LOCATOR_PREFIX));
  if (locatorArgForMutex !== undefined && expSelectors.length >= 2) {
    throw new ShowError(
      t("cli.show.locatorExpConflict", { locator: locatorArgForMutex, exp: expSelectors.join(", ") }),
    );
  }

  const root = flags.results !== undefined ? resolve(cwd, flags.results) : join(cwd, ".niceeval");
  if (flags.results !== undefined && !existsSync(root)) {
    throw new ShowError(t("cli.show.runDirMissing", { dir: root }));
  }

  const results = await openResults(root);
  if (results.experiments.length === 0) {
    const skipped = results.skipped.length > 0 ? `\n${skippedRunsText(results.skipped, root, cwd)}\n` : "";
    throw new ShowError(t("cli.show.noResults", { root }) + skipped);
  }

  // `@<locator>` 位置参数:身份直达单个 attempt,与 eval id 前缀匹配完全不同的语义
  // (`@` 打头对 eval id 天然无歧义,见 locator.ts),必须在下面的前缀匹配逻辑之前分流掉,
  // 不然 "@1x7f3q" 会被当成一个谁都匹配不到的 eval id 前缀,报「no eval match」这种文不对题的
  // 错误。(mutex 校验已在 openResults 之前用 locatorArgForMutex 做过,这里复用同一个值。)
  const locatorArg = locatorArgForMutex;
  if (locatorArg !== undefined) {
    if (patterns.length !== 1) {
      throw new ShowError(
        `An attempt locator ("${locatorArg}") must be the only positional argument; got ${patterns.length}: ${patterns.join(", ")}.`,
      );
    }
    let attempt;
    try {
      attempt = resolveLocator(results, locatorArg);
    } catch (e) {
      if (e instanceof MalformedLocatorError) throw new ShowError(t("cli.show.locatorMalformed", { message: e.message }));
      if (e instanceof LocatorNotFoundError) throw new ShowError(t("cli.show.locatorNotFound", { message: e.message }));
      throw e;
    }
    if (evidence) {
      // locator = 单元素范围:与下面「证据切面是宿主本体」分支共用同一个范围通用实现
      // (renderEvidenceSections),不另立「locator 专属」代码路径。
      io.out((await renderEvidenceSections([attempt], flags, cwd, io.width)) + "\n");
      return;
    }
    const attemptEvidence = await loadAttemptEvidence(attempt);
    // 无证据 flag:选中当前 report definition 里唯一的 attempt-input page,注入这份 evidence,
    // 走与其它 page 完全相同的 resolve → validate → render 管线(docs/feature/reports/show/attempt.md;
    // docs/feature/reports/library/attempt-detail.md「在 show 与 view 怎样渲染」)。不带 --report
    // 时装载内建 standard,其中就带这张 page;--report 指向的自定义报告没有声明 attempt-input page
    // 时报完整用户反馈,不回退到内建详情(三条解决路径都在错误文案里给出)。
    const report = await loadHostReport(cwd, flags.report);
    const attemptPage = report.pages.find((p) => p.input === "attempt");
    if (attemptPage === undefined) {
      const sourceLabel = flags.report ?? "the built-in report";
      throw new ShowError(
        `error: ${sourceLabel} has no attempt-input page — "${locatorArg}" cannot be opened without one. ` +
          `Add one: use \`extends: standard\` (inherits its attempt page), import { standardAttemptPage } from ` +
          `"niceeval/report/built-in" and add it to your pages list, or declare your own \`input: "attempt"\` page.\n`,
      );
    }
    const locale = detectLocale();
    const selection = selectCurrentResults(results, { fresh: flags.fresh });
    const meta = await buildHostReportMeta(report, selection);
    const text = await renderHostPageText(
      attemptPage,
      {
        scope: selection,
        results,
        report: meta,
        page: { id: attemptPage.id, input: "attempt", locator: attempt.locator!, evidence: attemptEvidence },
      },
      { width: io.width, locale, panelMode: io.panelMode },
    );
    io.out(text + "\n");
    return;
  }

  // `--exp` 的范围校验(docs/feature/reports/show.md「选择结果范围」):0/1 个沿用前缀收窄
  // (可能匹配多个 experiment);2 个以上进入对照语义,每个必须恰好解析到一个 experiment。
  const experimentIds = results.experiments.map((e) => e.id);
  assertExperimentSelectors(experimentIds, expSelectors);
  if (expSelectors.length === 1 && filterExperiments(results.experiments, expSelectors).length === 0) {
    throw new ShowError(t("cli.show.noExperimentMatch", { arg: expSelectors[0], experiments: experimentIds.join(", ") }));
  }

  const experimentFilter = expSelectors.length > 0 ? expSelectors : undefined;
  const selection = selectCurrentResults(results, { experiment: experimentFilter, patterns, fresh: flags.fresh });
  const matchedEvalIds = [...new Set(selection.attempts.map((a) => a.evalId))].sort();

  if (patterns.length > 0 && matchedEvalIds.length === 0) {
    const known = [
      ...new Set(filterExperiments(results.experiments, experimentFilter).flatMap((e) => e.evalIds)),
    ].sort();
    throw new ShowError(
      t("cli.show.noEvalMatch", { patterns: patterns.join(", "), evals: known.join(", ") || "(none)" }),
    );
  }

  // 证据切面是宿主本体:出现即走证据室,不渲染报告槽(与默认报告同规则)。每个切片接受任意
  // 范围——范围含多个 attempt 时按 experimentId、evalId、attempt 序逐 attempt 分节
  // (renderEvidenceSections,与上面 `@<locator>` 单元素范围共用同一份实现)。
  if (evidence) {
    io.out((await renderEvidenceSections(selection.attempts, flags, cwd, io.width)) + "\n");
    return;
  }

  // --history:执行时间轴(docs/feature/reports/show.md「--history:一个 eval 的执行时间轴」)。
  // 对 Scope 中匹配的每个 experimentId + evalId 分节,逐 attempt 而非逐快照;时间轴只列
  // 真实执行 —— resume 携带的复印件按 attempt 身份键去重后不占行。与重复 `--exp` 正交且不
  // 变形:时间轴本来就按 experimentId 分节,条件只是收窄节集合。
  if (flags.history) {
    const experiments = filterExperiments(results.experiments, experimentFilter);
    // eval 位置参数与 Scope 选择用同一个前缀谓词(单点在 shared/aggregate.ts),不另立口径。
    const matchesPattern = patterns.length > 0 ? evalPrefixPredicate(patterns) : () => true;
    const blocks: string[] = [];
    for (const exp of experiments) {
      const evalIds = [...exp.evalIds].filter(matchesPattern).sort();
      for (const evalId of evalIds) {
        const rows = attemptHistory(exp, evalId);
        if (rows.length === 0) continue;
        blocks.push(attemptHistoryText({ experimentId: exp.id, evalId, rows }));
      }
    }
    io.out(blocks.join("\n\n") + "\n");
    return;
  }

  // 缺省切片选择表(docs/feature/reports/show.md「缺省切片的选择规则」):`--exp` 出现两次以上
  // 且没有被 `--report` 接管时是对照矩阵,不是报告槽的裸榜单——与 `--report` 互斥(缺省切片被
  // 报告树替换时对照矩阵不再适用)。DeltaTable 组件接线前先给诚实占位错误(renderCompareSlice)。
  if (flags.report === undefined && expSelectors.length >= 2) {
    renderCompareSlice(expSelectors);
  }

  // 报告槽:裸 show / eval id 前缀 / 单个 `--exp` 都落在这里,装载 `niceeval/report/built-in`
  // 的默认导出,--report 整槽替换——同一条
  // 「装载 → 规范化(外壳 + 非空页列表)→ 逐页渲染」管线(docs/feature/reports/library/shell.md)。
  // locale = CLI 界面语言(NICEEVAL_LANG / LC_* / LANG 检测):报告 chrome 文案跟随终端语言。
  const report = await loadHostReport(cwd, flags.report);
  const locale = detectLocale();
  const commandContext: HostCommandContext = {
    patterns,
    ...(flags.results !== undefined ? { results: flags.results } : {}),
    ...(flags.report !== undefined ? { report: flags.report } : {}),
    ...(flags.experiment !== undefined ? { experiment: flags.experiment } : {}),
  };
  const sourceLabel = flags.report ?? "the built-in report";

  // 初始页 = --page 指定的页,缺省第一张可导航页(docs/feature/reports/show/reports.md
  // Case 2);本地宿主只 resolve 被打开的这一页——其余页只留 id / title,不触发取数(见
  // shell.md「行为约束」「本地宿主只 resolve 被打开的页」)。navigation:false 的页(参数化
  // attempt 详情)不参与缺省选择,也不能被 --page 直接打开——没有 locator 不能拿 Scope 强行
  // resolve(architecture.md「Attempt 详情是一张参数化 page」)。
  let page = report.pages.find((p) => p.navigation !== false) ?? report.pages[0];
  if (flags.page !== undefined) {
    const hit = report.pages.find((p) => p.id === flags.page);
    if (!hit) {
      // 用法错误:列出可用页 id(docs/feature/reports/show/reports.md Case 1/2 的报错样例)。
      throw new ShowError(
        `error: page "${flags.page}" not found in ${sourceLabel}. Available pages: ${report.pages.filter((p) => p.navigation !== false).map((p) => p.id).join(", ")}\n`,
      );
    }
    if (hit.input === "attempt") {
      throw new ShowError(
        `error: page "${hit.id}" in ${sourceLabel} is an attempt-input page and needs a locator — it cannot be opened with --page directly. Use niceeval show @<locator> instead.\n`,
      );
    }
    page = hit;
  }

  // attemptCommand 留给渲染管线的默认值:AttemptLocator 已经是可直接 `niceeval show @<locator>`
  // 的真实 CLI 语法,不需要再反查 eval id 拼一条近似命令。
  const meta = await buildHostReportMeta(report, selection);
  const text = await renderHostPageText(
    page,
    { scope: selection, results, report: meta, page: { id: page.id, input: "scope" } },
    {
      width: io.width,
      locale,
      panelMode: io.panelMode,
      commandContext: { ...commandContext, ...(flags.page !== undefined ? { page: flags.page } : {}) },
    },
  );

  // 页数大于一时尾部附「其余页」索引(只列未渲染、且可导航的页,不倾倒内容);单页定义
  // 没有这段;隐藏的 attempt page 不出现在「其余页」里。
  const remaining = report.pages.filter((p) => p.id !== page.id && p.navigation !== false);
  if (remaining.length === 0) {
    io.out(text + "\n");
    return;
  }
  const tail = otherPagesText({
    otherPages: remaining.map((p) => ({ id: p.id, title: p.title })),
    command: commandContext,
    locale,
  });
  io.out(`${text}\n\n${tail}\n`);
}
