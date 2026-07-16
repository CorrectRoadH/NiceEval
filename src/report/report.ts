// defineReport:唯一可被宿主装载的产物 —— 一层外壳(标题、外链、页脚、head 标签、脚本、样式)加
// 非空页列表;单页与多页不是两种机制,页数只是列表长度(docs/feature/reports/library/shell.md)。
// 入参有两级缩写,各有精确展开:树入参 ≡ { content: 树 } ≡ pages: [{ id: "report",
// title: 内置页名, content: 树 }]。`content` 与 `pages` 恰好声明一个,没有隐式默认。
//
// renderReportToText 是 text 宿主(show)的装载入口;web 宿主(view)的
// renderReportToStaticHtml 在 ./web.ts(那一侧才 import react-dom)。管线以页为单位执行:
// 装载(规范化 + 静态校验)→ resolve → validate → render。

import type { Results, Scope } from "../results/types.ts";
import {
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  validateReportTree,
  ResolveMemo,
  type ReportNode,
  type TextRenderOptions,
} from "./tree.ts";
import {
  localizedTextEquals,
  resolveLocalizedText,
  type LocalizedText,
  type ReportLocale,
} from "./locale.ts";

// ───────────────────────── 公开形状 ─────────────────────────

export interface ReportLink {
  label: LocalizedText;
  href: string;
  /**
   * 可选内联 SVG 字标,web 面渲染在 label 前,静态导出原样内联。
   * 不收组件:外壳声明经序列化边界进前端,ReactNode 过不去,可序列化是外壳契约的一部分。
   * 内容是作者义务,宿主不校验——与 scripts 同一约定。
   */
  icon?: { svg: string };
}

/** src 是相对顶层报告文件的路径;两种形态不可同时出现。 */
export type ReportAsset = { src: string; inline?: never } | { inline: string; src?: never };

/**
 * 结构化 head 标签。tag 是白名单闭集——head 是元数据与第三方脚本的注入口,不是 HTML 后门。
 * attrs 值为 true 渲染裸布尔属性(async、defer),字符串渲染 `key="value"`(值转义后落 HTML);
 * 属性语义与脚本内容同一约定——作者义务,宿主不校验。
 * meta / link 无子内容由类型表达;script / style 的 children 是原样文本,不转义。
 */
export type HeadTag =
  | { tag: "meta" | "link"; attrs: Record<string, string | true>; children?: never }
  | { tag: "script" | "style"; attrs?: Record<string, string | true>; children?: string };

export interface ReportShell {
  /** 标题:首页 hero 与浏览器标题。页头左端是恒定的 NiceEval 品牌字标,不由 title 覆盖;回退链 def.title → 唯一快照 name → 内置文案「Eval 运行结果 / Eval Results」。 */
  title?: LocalizedText;
  /** 页头右侧的外部链接,如 GitHub、文档、CI。 */
  links?: ReportLink[];
  /** 每页页脚的一段文字;省略时不渲染页脚(品牌行恒在 hero 下方,不占页脚)。 */
  footer?: LocalizedText;
  /**
   * 注入每页 `<head>` 的结构化标签,在官方与外壳样式之后按声明顺序渲染。
   * 第三方 snippet(分析、埋点、评论)、SEO meta、favicon、字体、JSON-LD 的家:
   * 声明什么标签就渲染什么标签,宿主只做结构校验,新的第三方接入不需要契约变更。
   */
  head?: HeadTag[];
  /** 注入每个页面的脚本,在官方增强脚本之后、按声明顺序于 </body> 前加载。 */
  scripts?: ReportAsset[];
  /** 注入每个页面的样式表,在官方样式之后按声明顺序加载。 */
  styles?: ReportAsset[];
}

export type NonEmptyArray<T> = readonly [T, ...T[]];

export interface ReportPage {
  /** 页面身份:`--page <id>` 的取值、web 路由 `#/page/<id>` 与导航锚。小写字母、数字与连字符。 */
  id: string;
  /** 导航中的页名。 */
  title: LocalizedText;
  /** 这一页的报告树;ReportDefinition 不是 ReportNode,页装不进外壳。 */
  content: ReportNode;
}

/** content / pages 互斥由类型表达,不把非法状态留到运行期。 */
export type ReportDef = ReportShell &
  (
    | { content: ReportNode; pages?: never }
    | { pages: NonEmptyArray<ReportPage>; content?: never }
  );

const REPORT_DEFINITION: unique symbol = Symbol.for("niceeval.report.definition");

/**
 * defineReport 的唯一产物:只作 --report 文件的默认导出,交给宿主装载。
 * 它不是 ReportNode——不能放进任何 content 或报告树,外壳因此不可嵌套。
 * 字段是装载规范化后的形态:pages 恒非空,links / head / scripts / styles 恒为数组。
 */
export interface ReportDefinition {
  readonly kind: "report";
  readonly title?: LocalizedText;
  readonly links: readonly ReportLink[];
  readonly footer?: LocalizedText;
  readonly head: readonly HeadTag[];
  readonly scripts: readonly ReportAsset[];
  readonly styles: readonly ReportAsset[];
  readonly pages: NonEmptyArray<ReportPage>;
}

/** 规范化后的报告声明,经组合组件 ctx.report 只读可见(scripts / styles 是注入资产,不进)。 */
export interface ReportMeta {
  /** 走完回退链(声明 title → 唯一快照 name → 内置文案「Eval 运行结果 / Eval Results」)后的标题。 */
  title: LocalizedText;
  /** 页头外链;声明省略时为空数组。 */
  links: readonly ReportLink[];
  footer?: LocalizedText;
  /** 规范化后的页列表(id 与导航页名),恒非空。 */
  pages: NonEmptyArray<{ id: string; title: LocalizedText }>;
  /** 当前渲染中的页 id。 */
  pageId: string;
}

/** 单页缩写展开出的唯一页 id 与内置页名。 */
export const DEFAULT_PAGE_ID = "report";
const DEFAULT_PAGE_TITLE: LocalizedText = { en: "Report", "zh-CN": "报告" };

// ───────────────────────── 装载规范化与静态校验 ─────────────────────────

const CONTENT_NEXT_STEP =
  'To render the built-in report content, write content: <ExperimentComparison /> (imported from "niceeval/report").';

function isReportNodeInput(value: unknown): boolean {
  if (value === null || value === undefined || typeof value === "boolean") return true;
  if (Array.isArray(value)) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value &&
    (value as { kind?: unknown }).kind !== "report"
  );
}

function assertNotDefinition(value: unknown, where: string): void {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "report" &&
    (value as Record<symbol, unknown>)[REPORT_DEFINITION] === true
  ) {
    throw new Error(
      `${where} received a defineReport(...) product, but a report definition is not a report node — the shell cannot nest. ` +
        "Pass the page's tree or component here, and export the defineReport product only as the file's default export.",
    );
  }
}

function assertLocalizedText(value: unknown, where: string): asserts value is LocalizedText {
  if (typeof value === "string") {
    if (value.length === 0) {
      throw new Error(`${where} must not be an empty string. Give it a visible label, e.g. "Overview".`);
    }
    return;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const hasNonEmpty = Object.values(value as Record<string, unknown>).some(
      (v) => typeof v === "string" && v.length > 0,
    );
    if (!hasNonEmpty) {
      throw new Error(
        `${where} is a LocalizedText object with no non-empty value. Provide at least one locale entry, e.g. { en: "Overview" }.`,
      );
    }
    return;
  }
  throw new Error(
    `${where} must be a LocalizedText (a string, or a { [locale]: string } record); got ${typeof value}.`,
  );
}

const PAGE_ID_PATTERN = /^[a-z0-9-]+$/;

/** 本地资产路径纪律(shell.md「行为约束」):相对报告文件的普通相对路径,拒绝 `..` 段、绝对路径与 `~`。 */
function assertLocalAssetPath(src: string, where: string): void {
  const segments = src.split(/[\\/]+/);
  if (src.startsWith("/") || /^[A-Za-z]:/.test(src) || src.startsWith("~") || segments.includes("..")) {
    throw new Error(
      `defineReport ${where} "${src}" is not allowed: only plain relative paths (optionally with a ./ prefix) resolve against the report file — no ".." segments, absolute paths, or "~". Move the asset next to the report file and reference it relatively.`,
    );
  }
}

function assertAssets(assets: unknown, field: "scripts" | "styles"): ReportAsset[] {
  if (assets === undefined) return [];
  if (!Array.isArray(assets)) {
    throw new Error(`defineReport ${field} must be an array of { src } or { inline } entries.`);
  }
  for (const asset of assets as Array<Record<string, unknown>>) {
    const hasSrc = typeof asset?.src === "string";
    const hasInline = typeof asset?.inline === "string";
    if (hasSrc === hasInline) {
      throw new Error(
        `Each defineReport ${field} entry must have exactly one of "src" (a path relative to the report file) or "inline" (literal content).`,
      );
    }
    if (hasSrc) {
      const src = asset.src as string;
      // 外链不属于增强层资产:第三方外链标签的家是 head 通道。
      if (/^https?:\/\//i.test(src) || src.startsWith("//")) {
        throw new Error(
          `defineReport ${field} src "${src}" is an external URL — ${field} take local files and inline content (the host pipeline vendors them). Declare third-party external tags in "head" instead, e.g. head: [{ tag: "script", attrs: { async: true, src: "…" } }].`,
        );
      }
      assertLocalAssetPath(src, `${field} src`);
    }
  }
  return assets as ReportAsset[];
}

const HEAD_TAG_NAMES = new Set(["meta", "link", "script", "style"]);
const HEAD_ATTR_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.:-]*$/;

function assertHeadTags(tags: unknown): HeadTag[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags)) {
    throw new Error(
      'defineReport head must be an array of { tag, attrs?, children? } entries (tag: "meta" | "link" | "script" | "style").',
    );
  }
  for (const entry of tags as Array<Record<string, unknown>>) {
    const tag = entry?.tag;
    // 白名单闭集:head 是元数据与第三方脚本的注入口,不是 HTML 后门;标题走 title 字段回退链。
    if (typeof tag !== "string" || !HEAD_TAG_NAMES.has(tag)) {
      throw new Error(
        `defineReport head tag ${JSON.stringify(tag)} is not allowed — head injects metadata and third-party tags, and the allowed tags are "meta", "link", "script", "style". For the document title, use the shell "title" field instead.`,
      );
    }
    const attrs = entry.attrs;
    if (attrs !== undefined && (typeof attrs !== "object" || attrs === null || Array.isArray(attrs))) {
      throw new Error(
        `defineReport head <${tag}> attrs must be a { name: string | true } record (true renders a bare boolean attribute like async).`,
      );
    }
    if ((tag === "meta" || tag === "link") && attrs === undefined) {
      throw new Error(
        `defineReport head <${tag}> needs attrs — a bare <${tag}> renders nothing. Declare e.g. { tag: "${tag}", attrs: { ${tag === "meta" ? 'name: "…", content: "…"' : 'rel: "…", href: "…"'} } }.`,
      );
    }
    const attrRecord = (attrs ?? {}) as Record<string, unknown>;
    for (const [name, value] of Object.entries(attrRecord)) {
      if (!HEAD_ATTR_NAME_PATTERN.test(name)) {
        throw new Error(
          `defineReport head <${tag}> attribute name ${JSON.stringify(name)} is not a valid HTML attribute name. Use letters, digits, "-", "_", ":" or ".".`,
        );
      }
      if (value !== true && typeof value !== "string") {
        throw new Error(
          `defineReport head <${tag}> attribute "${name}" must be a string or true (true renders a bare boolean attribute like async); got ${typeof value}.`,
        );
      }
    }
    // 宿主自有的文档单例:charset / viewport 由宿主外壳拥有,声明它们装载报错。
    if (tag === "meta" && attrRecord.charset !== undefined) {
      throw new Error(
        "defineReport head must not declare <meta charset> — the document charset is owned by the host shell. Remove the entry.",
      );
    }
    if (tag === "meta" && typeof attrRecord.name === "string" && attrRecord.name.toLowerCase() === "viewport") {
      throw new Error(
        'defineReport head must not declare <meta name="viewport"> — the viewport is owned by the host shell. Remove the entry.',
      );
    }
    const children = entry.children;
    if (children !== undefined) {
      if (tag === "meta" || tag === "link") {
        throw new Error(
          `defineReport head <${tag}> does not take children — <${tag}> is a void element; put the content in attrs.`,
        );
      }
      if (typeof children !== "string") {
        throw new Error(
          `defineReport head <${tag}> children must be a string of literal ${tag === "script" ? "JavaScript" : "CSS"}; got ${typeof children}.`,
        );
      }
      // children 原样落进标签,闭合序列在该上下文无法转义,会提前截断标签。
      if (children.toLowerCase().includes(`</${tag}`)) {
        throw new Error(
          `defineReport head <${tag}> children contain "</${tag}>" — that sequence cannot be escaped inside a <${tag}> and would close the tag early. Split the content into two entries or move it into a local file asset.`,
        );
      }
    }
    // src / href 按 scheme 分流:http(s) 外链原样透传;其余按本地路径纪律解析。
    for (const name of ["src", "href"]) {
      const value = attrRecord[name];
      if (typeof value !== "string") continue;
      if (/^https?:\/\//i.test(value)) continue;
      if (value.startsWith("//")) {
        throw new Error(
          `defineReport head <${tag}> ${name} "${value}" is protocol-relative — declare the scheme explicitly, e.g. "https:${value}".`,
        );
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        throw new Error(
          `defineReport head <${tag}> ${name} "${value}" uses a scheme other than http(s) — external head assets must be http(s) URLs. Anything else, ship as a local file next to the report and reference it relatively.`,
        );
      }
      assertLocalAssetPath(value, `head <${tag}> ${name}`);
    }
  }
  return tags as HeadTag[];
}

export function defineReport(content: ReportNode): ReportDefinition;
export function defineReport(def: ReportDef): ReportDefinition;
export function defineReport(input: ReportNode | ReportDef): ReportDefinition {
  assertNotDefinition(input, "defineReport(...)");
  const def: ReportDef = isReportNodeInput(input)
    ? ({ content: input as ReportNode } as ReportDef)
    : (input as ReportDef);
  if (typeof def !== "object" || def === null) {
    throw new Error(
      "defineReport expects a report tree or a config object ({ title?, links?, footer?, head?, scripts?, styles?, content | pages }). " +
        CONTENT_NEXT_STEP,
    );
  }

  const hasContent = "content" in def && def.content !== undefined;
  const hasPages = "pages" in def && def.pages !== undefined;
  if (hasContent && hasPages) {
    throw new Error(
      `defineReport got both "content" and "pages" — declare exactly one. Keep "pages" for a multi-page report, or keep a single tree in "content". ${CONTENT_NEXT_STEP}`,
    );
  }
  if (!hasContent && !hasPages) {
    throw new Error(
      `defineReport got neither "content" nor "pages" — declare exactly one; omission is not a meaningful value, the file must show what renders. ${CONTENT_NEXT_STEP}`,
    );
  }

  let pages: ReportPage[];
  if (hasContent) {
    assertNotDefinition(def.content, 'defineReport "content"');
    pages = [{ id: DEFAULT_PAGE_ID, title: DEFAULT_PAGE_TITLE, content: def.content as ReportNode }];
  } else {
    const raw = def.pages as unknown;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(
        `defineReport "pages" must be a non-empty array of { id, title, content }. ${CONTENT_NEXT_STEP}`,
      );
    }
    const seen = new Set<string>();
    for (const page of raw as Array<Record<string, unknown>>) {
      if (typeof page?.id !== "string" || !PAGE_ID_PATTERN.test(page.id)) {
        throw new Error(
          `Report page id ${JSON.stringify(page?.id)} is invalid: ids are lowercase letters, digits and hyphens (they become --page values and #/page/<id> routes). Rename it, e.g. "overview".`,
        );
      }
      if (seen.has(page.id)) {
        throw new Error(
          `Report page id "${page.id}" is declared twice — ids must be unique within one file (they are the --page selector and the web route). Rename one of the pages.`,
        );
      }
      seen.add(page.id);
      assertLocalizedText(page.title, `Report page "${page.id}" title`);
      assertNotDefinition(page.content, `Report page "${page.id}" content`);
    }
    pages = raw as ReportPage[];
  }

  if (def.title !== undefined) assertLocalizedText(def.title, "defineReport title");
  if (def.footer !== undefined) assertLocalizedText(def.footer, "defineReport footer");
  const links = def.links ?? [];
  if (!Array.isArray(links)) throw new Error("defineReport links must be an array of { label, href }.");
  for (const link of links) {
    assertLocalizedText((link as ReportLink)?.label, "defineReport link label");
    if (typeof (link as ReportLink)?.href !== "string" || (link as ReportLink).href.length === 0) {
      throw new Error("defineReport link href must be a non-empty string URL.");
    }
    // icon 唯一合法形状是 { svg: string }(无类型 JS 传组件 / ReactNode / 裸字符串都在装载期拒绝):
    // 外壳声明经序列化边界进前端,ReactNode 过不去,可序列化是外壳契约的一部分。
    const icon = (link as { icon?: unknown }).icon;
    if (icon !== undefined) {
      const svg = (icon as { svg?: unknown })?.svg;
      if (typeof icon !== "object" || icon === null || typeof svg !== "string" || svg.length === 0) {
        throw new Error(
          'defineReport link "icon" must be { svg: string } — an inline SVG string rendered before the label. ' +
            "Components and React nodes are not accepted: the shell declaration crosses a serialization boundary. " +
            'Write e.g. icon: { svg: "<svg …>…</svg>" }.',
        );
      }
    }
  }

  const definition = {
    kind: "report" as const,
    ...(def.title !== undefined ? { title: def.title } : {}),
    links: [...links],
    ...(def.footer !== undefined ? { footer: def.footer } : {}),
    head: assertHeadTags(def.head),
    scripts: assertAssets(def.scripts, "scripts"),
    styles: assertAssets(def.styles, "styles"),
    pages: pages as unknown as NonEmptyArray<ReportPage>,
  };
  Object.defineProperty(definition, REPORT_DEFINITION, { value: true });
  return definition;
}

/** 宿主装载报告文件时用:默认导出是不是 defineReport 的产物。 */
export function isReportDefinition(value: unknown): value is ReportDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "report" &&
    (value as Record<symbol, unknown>)[REPORT_DEFINITION] === true
  );
}

// ───────────────────────── ReportMeta(标题回退单点)─────────────────────────

/** 标题回退链的终点:内置文案「Eval 运行结果 / Eval Results」(shell.md「行为约束」)。 */
export const FALLBACK_REPORT_TITLE: LocalizedText = { en: "Eval Results", "zh-CN": "Eval 运行结果" };

/**
 * 标题回退链的单点实现:def.title → Scope 中唯一且相同(LocalizedText 深相等)的非空快照
 * name → 内置文案「Eval 运行结果 / Eval Results」。快照中没有 name 或存在多个不同 name 时
 * 都落到内置文案,不按数组顺序挑。
 */
export function resolveReportTitle(definition: ReportDefinition, scope: Scope): LocalizedText {
  if (definition.title !== undefined) return definition.title;
  const names = scope.snapshots
    .map((s) => s.name)
    .filter((name): name is LocalizedText => name !== undefined && name !== "");
  if (names.length === 0) return FALLBACK_REPORT_TITLE;
  const first = names[0]!;
  return names.every((name) => localizedTextEquals(name, first)) ? first : FALLBACK_REPORT_TITLE;
}

/** 规范化声明 → 组合组件可见的 ReportMeta(scripts / styles 是注入资产,不进)。 */
export function buildReportMeta(definition: ReportDefinition, scope: Scope, pageId: string): ReportMeta {
  return {
    title: resolveReportTitle(definition, scope),
    links: definition.links,
    ...(definition.footer !== undefined ? { footer: definition.footer } : {}),
    pages: definition.pages.map((page) => ({ id: page.id, title: page.title })) as unknown as NonEmptyArray<{
      id: string;
      title: LocalizedText;
    }>,
    pageId,
  };
}

// ───────────────────────── 页选择与 text 宿主入口 ─────────────────────────

/** `--page` 未命中:宿主据此按用法错误退出并列出可用页 id。 */
export class ReportPageNotFoundError extends Error {
  readonly pageId: string;
  readonly available: string[];
  constructor(pageId: string, available: string[]) {
    super(`page "${pageId}" not found. Available pages: ${available.join(", ")}`);
    this.pageId = pageId;
    this.available = available;
  }
}

export function pickReportPage(definition: ReportDefinition, pageId?: string): ReportPage {
  if (pageId === undefined) return definition.pages[0];
  const page = definition.pages.find((p) => p.id === pageId);
  if (!page) {
    throw new ReportPageNotFoundError(
      pageId,
      definition.pages.map((p) => p.id),
    );
  }
  return page;
}

/** 宿主注入的渲染上下文:官方口径挑好的 Scope 与结果根完整读取面。 */
export interface ReportHostContext {
  scope: Scope;
  /** 组合组件 ctx.results 的来源;历史视图从这里自行挑 Snapshot[]。 */
  results: Results;
}

export interface RenderReportTextOptions extends TextRenderOptions {
  /** 渲染哪一页;缺省第一页。未命中抛 ReportPageNotFoundError。 */
  pageId?: string;
}

/**
 * 挑选警告的 text 形态:每条渲染好的 message 前缀 "! ",一行一条。宿主级前置块——
 * 宿主是 warning 的唯一呈现者,组件数据不复制 warning;裸跑 / --report 都在报告顶上
 * 如实报残缺,不静默(docs/feature/reports/architecture.md「Scope 是计算入口」)。
 */
function renderScopeWarningsText(scope: Scope, _locale: ReportLocale): string {
  return scope.warnings.map((w) => `! ${w.message}`).join("\n");
}

/**
 * text 宿主的装载语义:选页 → resolve(组合展开 + spec 取数,唯一的 await 边界)→ 树校验 →
 * 遍历渲染 text 面;Scope 有挑选警告时在报告顶部前置一块 "! <message>"。不需要 react-dom。
 */
export async function renderReportToText(
  definition: ReportDefinition,
  ctx: ReportHostContext,
  options?: RenderReportTextOptions,
): Promise<string> {
  const page = pickReportPage(definition, options?.pageId);
  const meta = buildReportMeta(definition, ctx.scope, page.id);
  const resolved = await resolveReportTree(page.content, {
    scope: ctx.scope,
    results: ctx.results,
    report: meta,
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  const textCtx = createTextContext(options);
  const body = renderNodeToText(resolved, textCtx);
  return ctx.scope.warnings.length > 0
    ? [renderScopeWarningsText(ctx.scope, textCtx.locale), body].join("\n\n")
    : body;
}

/** 页索引标题行(show 多页索引 / view 导航共用的解析结果):按 locale 解析的标题字符串。 */
export function reportTitleText(definition: ReportDefinition, scope: Scope, locale: ReportLocale): string {
  return resolveLocalizedText(resolveReportTitle(definition, scope), locale);
}

// ───────────────────────── 逐页(树)渲染入口:宿主联系面 ─────────────────────────

/** 宿主索引命令的完整上下文(docs/feature/reports/show/reports.md「索引命令携带完整上下文」)。 */
export interface HostCommandContext {
  patterns: string[];
  results?: string;
  experiment?: string;
  report?: string;
  page?: string;
}

function quoteArg(value: string): string {
  return /^[A-Za-z0-9._/@-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** 按上下文拼组索引的可复制命令:`niceeval show <patterns> --experiment <id> [--results/--report/--page]`。 */
function experimentCommandFor(ctx: HostCommandContext): (experimentIdPrefix: string) => string {
  return (prefix) => {
    const parts = ["niceeval show", ...ctx.patterns.map(quoteArg), `--experiment ${quoteArg(prefix)}`];
    if (ctx.results !== undefined) parts.push(`--results ${quoteArg(ctx.results)}`);
    if (ctx.report !== undefined) parts.push(`--report ${quoteArg(ctx.report)}`);
    if (ctx.page !== undefined) parts.push(`--page ${quoteArg(ctx.page)}`);
    return parts.join(" ");
  };
}

/** 逐页渲染的宿主上下文:官方口径的 Scope、结果根读取面与规范化声明(ctx.report)。 */
export interface ReportTreeHostContext {
  scope: Scope;
  results: Results;
  report: ReportMeta;
}

export interface RenderTreeTextOptions extends TextRenderOptions {
  /** 组索引命令的完整上下文;给了就按它拼命令,experimentCommand 显式注入时以后者为准。 */
  commandContext?: HostCommandContext;
}

/**
 * 渲染一页报告树的 text 面(宿主逐页调用;页选择归宿主):
 * resolve(组合展开 + spec 取数)→ validate → render。Scope 有挑选警告时在页顶前置
 * "! <message>" 块——宿主是 warning 的唯一呈现者,组件数据不复制 warning。
 */
export async function renderReportTreeToText(
  tree: ReportNode,
  ctx: ReportTreeHostContext,
  options?: RenderTreeTextOptions,
): Promise<string> {
  const resolved = await resolveReportTree(tree, {
    scope: ctx.scope,
    results: ctx.results,
    report: ctx.report,
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  const textCtx = createTextContext({
    ...options,
    ...(options?.experimentCommand === undefined && options?.commandContext !== undefined
      ? { experimentCommand: experimentCommandFor(options.commandContext) }
      : {}),
  });
  const body = renderNodeToText(resolved, textCtx);
  return ctx.scope.warnings.length > 0
    ? [renderScopeWarningsText(ctx.scope, textCtx.locale), body].join("\n\n")
    : body;
}
