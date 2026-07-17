// server(data.ts)与前端(app/)共用的 view 数据形状。
// viewData 会被序列化进静态 HTML,两边必须对同一份声明编程;只允许 type import。
//
// viewData 只携带证据室与壳需要的东西:快照明细(locator / artifactBase 已注入)、
// skipped、项目名与 run 元信息。统计口径(KPI / 榜单 / 挑选警告)整体住在报告槽的
// 静态 HTML 里(ExperimentComparison 或 --report 的报告自己算),壳与报告之间没有第二条数据通道。

import type { EvalResult, LocalizedText } from "../../types.ts";
import type { ReportLocale } from "../../report/locale.ts";
import type { AttemptLocator } from "../../results/locator.ts";

export type { AttemptLocator };

/**
 * 一页报告的双语静态 HTML:同一棵页树按 locale 渲染两遍(en / zh-CN),server 烘成
 * <template id="niceeval-report-<pageId>-<locale>"> 静态块,前端按当前页与界面语言摆放
 * 对应块,切语言 / 切页不重算数据。
 */
export type ReportSlotHtml = Record<ReportLocale, string>;

/** 服务端渲染好的一页报告(HTML 本体不进 viewData,烘成 <template> 静态块)。 */
export interface ViewReportPageHtml {
  id: string;
  html: ReportSlotHtml;
}

/** 导航里的一页(id = `#/page/<id>` 路由与 `--page` 的取值)。 */
export interface ViewReportPageMeta {
  id: string;
  title: LocalizedText;
}

/**
 * 规范化后的报告外壳声明(docs/feature/reports/library/shell.md):壳(导航 / 页脚)由前端
 * 渲染,页内容消费 <template> 静态块。title 已走完回退链(def.title → 唯一且相同的快照 name →
 * 内置文案「Eval 运行结果 / Eval Results」),宿主落点只有浏览器 <title>(文档单例);
 * 页内 hero 标题由 Hero 组件消费同一取值链,品牌是组件、宿主页头不渲染任何品牌位。
 * scripts / styles 是注入资产,不进 viewData。
 * link 的 icon 是内联 SVG 字符串(原样透传、原样内联),不收组件——viewData 就是序列化边界。
 */
export interface ViewReportMeta {
  title: LocalizedText;
  links: { label: LocalizedText; href: string; icon?: { svg: string } }[];
  footer?: LocalizedText;
  pages: ViewReportPageMeta[];
  /** 初始页(--page 或声明序第一页);`#/page/<id>` 路由覆盖它。 */
  initialPageId: string;
}

/** view 侧的 attempt 结果 = 瘦身后的 EvalResult + loader 注入的深链身份(不透明 AttemptLocator,
 * `#/attempt/@<locator>` 路由的参数,与 Reports 的 MetricCell.refs / `ctx.attemptHref` 同一身份契约)
 * 与 artifact 基址。 */
export type ViewEvalResult = EvalResult & { locator?: AttemptLocator };

/**
 * 快照 = 单次跑的实验(experiment × 一次运行),与 niceeval/results 的 Snapshot 同口径。
 * 携带 attempt 明细供证据室(钻取 / AttemptModal / Runs / Traces)渲染;
 * 榜单统计不从这里算,吃 ViewData.table / overview 的官方产物。
 */
export interface ViewSnapshot {
  experimentId: string;
  agent: string;
  model?: string;
  startedAt: string;
  /** 快照的根相对路径(= niceeval/results 的 AttemptRef.snapshot,两段:`<experiment-dir>/<snapshot-dir>`)。 */
  run: string;
  /** 是否为该实验在 results.latest() 口径下的最新一次快照 —— 证据室的 latest 标记,与报告槽 Selection
   (现刻水位,可能合成自更早快照)是两个独立概念,不要混用。 */
  latest: boolean;
  /** 该快照的 attempt 明细(跨快照去重后的幸存条目;locator / artifactBase 已注入)。 */
  results: ViewEvalResult[];
}

/**
 * 目录扫描里被跳过的 run 的结构化条目;三种原因与 niceeval/results 的 skipped 一致。
 * 页面上的呈现不走它:不可读快照已形成 `unreadable-snapshot` Scope warning,由报告页内的
 * `ScopeWarnings` 组件显示;这里只随 viewData 携带原始事实。
 */
export interface SkippedRunNotice {
  /** run 目录,相对 cwd。 */
  dir: string;
  reason: "incompatible-version" | "malformed" | "incomplete";
  schemaVersion?: number;
  /** 完整 producer:只有 name === "niceeval" 才配得出 npx 命令,第三方 harness 如实报名字。 */
  producerName?: string;
  producerVersion?: string;
  /** incompatible-version 且 producer 是 niceeval:服务端拼好的查看命令。 */
  command?: string;
  /** malformed:一句诊断(invalid JSON / results 不是数组 …)。 */
  detail?: string;
}

/**
 * 烘焙进 HTML 的页面数据(证据室与壳)。时间/成本一律传原始值(ISO 字符串、number),
 * 格式化统一由前端按当前界面 locale 做。
 */
export interface ViewData {
  /** 最近一次 run 的 startedAt(ISO);没有历史 run 时缺省。 */
  lastRunAt?: string;
  /** 报告槽 Selection 合成自几个物理 run。 */
  composedRuns: number;
  /** 全部历史快照(跨快照按身份键去重后);attempt 详情路由对这份完整集合解析,不随报告 Scope 收窄。 */
  snapshots: ViewSnapshot[];
  /** 读不了的落盘(三种原因);呈现走报告页内的 ScopeWarnings(unreadable-snapshot warning)。 */
  skippedRuns?: SkippedRunNotice[];
  /** 报告外壳与页导航的声明(规范化后);缺省时前端按单页 `report` 兜底。 */
  report?: ViewReportMeta;
}
