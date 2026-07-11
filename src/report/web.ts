// web 宿主(view --report)的装载入口:同一棵树走 web 面,renderToStaticMarkup 吐静态
// HTML 烘进查看器的报告槽。只有这一侧真正 import react-dom(import 边界即运行时边界),
// 所以本文件不从 niceeval/report 的入口 re-export —— 宿主与测试按源路径 import。

import * as React from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// tsx 按「tsconfig 所在目录」为界应用 jsx 配置:CLI 在用户项目 cwd 下跑时,包内
// .tsx(primitives / react 组件的 web 面)落在用户 tsconfig 覆盖范围之外,esbuild
// 退化成 classic JSX(编译产物引用全局 React)。这里补上全局 React,web 面在两种
// 编译模式下都可渲染;只定义一次,不覆盖宿主已有的全局。
const g = globalThis as { React?: unknown };
if (g.React === undefined) g.React = React;
import type { AttemptRef } from "../results/index.ts";
import { runWithWebContext, validateReportTree, type WebContext } from "./tree.ts";
import { prepareDefaultReportData, runWithDefaultReportData } from "./official-report.tsx";
import { DEFAULT_REPORT_LOCALE, type ReportLocale } from "./locale.ts";
import type { ReportContext, ReportDefinition } from "./report.ts";

export interface StaticHtmlOptions {
  /** 证据室深链;缺省用 view 的 attempt 路由 `#/attempt/<snapshot>/<attempt>`。 */
  attemptHref?: (ref: AttemptRef) => string;
  /** 官方组件 chrome 文案的 locale;默认 "en"。 */
  locale?: ReportLocale;
}

/** build → 渲染前树校验(与 text 宿主同一遍)→ 备好官方水位 → 静态渲染 web 面。 */
export async function renderReportToStaticHtml(
  definition: ReportDefinition,
  ctx: ReportContext,
  options?: StaticHtmlOptions,
): Promise<string> {
  const node = await definition.build(ctx);
  validateReportTree(node);
  const defaultData = await prepareDefaultReportData(ctx.selection);
  const webCtx: WebContext = {
    attemptHref: options?.attemptHref ?? ((ref) => `#/attempt/${ref.snapshot}/${ref.attempt}`),
    locale: options?.locale ?? DEFAULT_REPORT_LOCALE,
  };
  return runWithDefaultReportData(defaultData, () =>
    runWithWebContext(webCtx, () => renderToStaticMarkup(node as ReactNode)),
  );
}
