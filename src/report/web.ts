// web 宿主(view --report)的装载入口:同一棵树走 web 面,renderToStaticMarkup 吐静态
// HTML 烘进查看器的报告槽。只有这一侧真正 import react-dom(import 边界即运行时边界),
// 所以本文件不从 niceeval/report 的入口 re-export —— 宿主与测试按源路径 import。

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AttemptLocator } from "../results/locator.ts";
import type { Scope } from "../results/types.ts";
import {
  resolveReportTree,
  runWithWebContext,
  validateReportTree,
  ResolveMemo,
  type WebContext,
} from "./tree.ts";
import { DEFAULT_REPORT_LOCALE, type ReportLocale } from "./locale.ts";
import { buildReportMeta, pickReportPage, type ReportDefinition, type ReportHostContext } from "./report.ts";

export interface StaticHtmlOptions {
  /** 渲染哪一页;缺省第一页。未命中抛 ReportPageNotFoundError。 */
  pageId?: string;
  /** 证据室深链;缺省用 view 的 attempt 路由 `#/attempt/@<locator>`(单段、不透明)。 */
  attemptHref?: (locator: AttemptLocator) => string;
  /** 官方组件 chrome 文案的 locale;默认 "en"。 */
  locale?: ReportLocale;
}

/**
 * web 宿主的装载语义:选页 → resolve(组合展开 + spec 取数,唯一的 await 边界)→
 * 树校验(与 text 宿主同一遍)→ 静态渲染 web 面。宿主不在报告树外另设警告通道——
 * 挑选警告的呈现件是 `ScopeWarnings` 组件,内建报告每页都放它,自定义报告放不放是
 * 作者义务(docs/feature/reports/architecture.md「Scope 是计算入口」)。
 */
export async function renderReportToStaticHtml(
  definition: ReportDefinition,
  ctx: ReportHostContext,
  options?: StaticHtmlOptions,
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
  const webCtx: WebContext = {
    attemptHref: options?.attemptHref ?? ((locator) => `#/attempt/${locator}`),
    locale: options?.locale ?? DEFAULT_REPORT_LOCALE,
  };
  return runWithWebContext(webCtx, () => renderToStaticMarkup(resolved as ReactNode));
}

/**
 * 渲染一页报告树的 web 面(宿主逐页调用;页选择归宿主):resolve → validate → 静态渲染。
 * 挑选警告由页内的 `ScopeWarnings` 组件呈现,宿主不前置任何树外块。
 * ctx.report 是宿主规范化后的声明。
 */
export async function renderReportTreeToStaticHtml(
  tree: import("./tree.ts").ReportNode,
  ctx: { scope: Scope; results: import("../results/types.ts").Results; report: import("./report.ts").ReportMeta },
  options?: { attemptHref?: (locator: AttemptLocator) => string; locale?: ReportLocale },
): Promise<string> {
  const resolved = await resolveReportTree(tree, {
    scope: ctx.scope,
    results: ctx.results,
    report: ctx.report,
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  const webCtx: WebContext = {
    attemptHref: options?.attemptHref ?? ((locator) => `#/attempt/${locator}`),
    locale: options?.locale ?? DEFAULT_REPORT_LOCALE,
  };
  return runWithWebContext(webCtx, () => renderToStaticMarkup(resolved as ReactNode));
}
