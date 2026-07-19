// Locale 只在 i18n 内核声明一次;页面数据形状与 server 共用 shared/types.ts 的声明。
export type { Locale } from "../../i18n/core.ts";
export type { LocalizedText } from "../../types.ts";
export type { ReportSlotHtml, ViewData, ViewReportPageMeta } from "../shared/types.ts";

/** 导航 tab:只有报告定义声明的页(`page:<id>`,路由 `#/page/<id>`),按声明序;宿主不追加任何项。 */
export type Tab = `page:${string}`;

declare global {
  interface Window {
    __NICEEVAL_VIEW_DATA__?: import("../shared/types.ts").ViewData;
  }
}
