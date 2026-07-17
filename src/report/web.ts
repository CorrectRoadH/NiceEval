// web 宿主(view --report)的装载入口:同一棵树走 web 面,renderToStaticMarkup 吐静态
// HTML 烘进查看器的报告槽。只有这一侧真正 import react-dom(import 边界即运行时边界),
// 所以本文件不从 niceeval/report 的入口 re-export —— 宿主与测试按源路径 import。

import * as React from "react";
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
import { groupScopeWarnings, warningDetailsLabel } from "./scope-warnings.ts";
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
 * 挑选警告的 HTML 形态:按「下一步动作」聚合(scope-warnings.ts,web/text 共用):
 * `.nre nre-report-warnings` 外壳内 `div.nre-warnings` 容器——多组时首行
 * `p.nre-warnings-summary` 汇总;每组 `li.nre-warning-group[data-category]` 含组头
 * (标题 + `span.nre-warning-badge[data-kind]` 徽标 + 去重后的组头命令)与原生
 * `<details>` 明细(逐条 `li.nre-warning[data-kind]` 的 message 原样;总条数 ≤ 3 默认展开)。
 * 命令渲染为可复制块(`.nre-warning-command`);无 command 不硬造动作。
 * 经 renderToStaticMarkup 走 React,文本自动转义。
 */
function renderScopeWarningsHtml(scope: Scope, locale: ReportLocale): string {
  const h = React.createElement;
  const { summary, groups, detailsOpen } = groupScopeWarnings(scope.warnings, locale);
  return renderToStaticMarkup(
    h(
      "div",
      { className: "nre nre-report-warnings" },
      h(
        "div",
        { className: "nre-warnings" },
        summary ? h("p", { className: "nre-warnings-summary" }, summary) : null,
        h(
          "ul",
          { className: "nre-warning-groups" },
          groups.map((group, i) =>
            h(
              "li",
              { key: i, className: "nre-warning-group", "data-category": group.category },
              h(
                "div",
                { className: "nre-warning-head" },
                h("span", { className: "nre-warning-title" }, group.title),
                group.badges.map((badge, j) =>
                  h("span", { key: j, className: "nre-warning-badge", "data-kind": badge.kind }, badge.text),
                ),
                group.headCommand
                  ? h(
                      "code",
                      { className: "nre-warning-command", "data-nre-copy": group.headCommand },
                      group.headCommand,
                    )
                  : null,
              ),
              h(
                "details",
                { className: "nre-warning-details", open: detailsOpen || undefined },
                h("summary", null, warningDetailsLabel(locale, group.warnings.length)),
                h(
                  "ul",
                  null,
                  group.warnings.map((w, j) =>
                    h(
                      "li",
                      { key: j, className: "nre-warning", "data-kind": w.kind },
                      w.message,
                      !group.headCommand && "command" in w && w.command
                        ? h(
                            "code",
                            { className: "nre-warning-command", "data-nre-copy": w.command },
                            w.command,
                          )
                        : null,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * web 宿主的装载语义:选页 → resolve(组合展开 + spec 取数,唯一的 await 边界)→
 * 树校验(与 text 宿主同一遍)→ 静态渲染 web 面;Scope 有挑选警告时在报告顶部前置
 * 一块警告 HTML(宿主是 warning 的唯一呈现者,组件数据不复制 warning)。
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
  const body = runWithWebContext(webCtx, () => renderToStaticMarkup(resolved as ReactNode));
  const warnings = ctx.scope.warnings.length > 0 ? renderScopeWarningsHtml(ctx.scope, webCtx.locale) : "";
  return warnings + body;
}

/**
 * 渲染一页报告树的 web 面(宿主逐页调用;页选择归宿主):resolve → validate → 静态渲染。
 * Scope 有挑选警告时在页顶前置警告块(带 command 的警告渲染为可复制命令)——宿主是
 * warning 的唯一呈现者,组件数据不复制 warning。ctx.report 是宿主规范化后的声明。
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
  const body = runWithWebContext(webCtx, () => renderToStaticMarkup(resolved as ReactNode));
  const warnings = ctx.scope.warnings.length > 0 ? renderScopeWarningsHtml(ctx.scope, webCtx.locale) : "";
  return warnings + body;
}
