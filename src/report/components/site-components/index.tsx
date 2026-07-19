// 官方双面组件的装配点:web 面(./HeroCard.tsx 等纯 React 组件)+ text 面(./faces.ts)+
// resolve 解析面(spec 形态由管线代调配套 ./compute.ts)。Hero 是组合组件(装配 HeroCard),
// 不产生自己的 data;PoweredBy 无 props,没有对应的计算函数或 validate。

import { defineComponent, type ReportComponent } from "../../definition/tree.ts";
import type { CopyFixPromptData, HeroData, ScopeWarning, TraceWaterfallRow } from "../../model/types.ts";
import type { LocalizedText } from "../../model/locale.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import {
  dataShapeError,
  isObject,
  makeDataComponent,
  hrefOf,
  type ChromeProps,
  type DataProps,
  type Validator,
} from "../shared.ts";
import { copyFixPromptData, heroData, scopeWarningsData, traceWaterfallData } from "./compute.ts";
import { heroCardText, scopeWarningsText, traceWaterfallText } from "./faces.ts";
import { HeroCard as HeroCardWeb } from "./HeroCard.tsx";
import { PoweredBy as PoweredByWeb } from "./PoweredBy.tsx";
import { ScopeWarnings as ScopeWarningsWeb } from "./ScopeWarnings.tsx";
import { CopyFixPrompt as CopyFixPromptWeb } from "./CopyFixPrompt.tsx";
import { TraceWaterfall as TraceWaterfallWeb } from "./TraceWaterfall.tsx";

const validateHeroData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!("latestStartedAt" in data) || (data.latestStartedAt !== null && typeof data.latestStartedAt !== "string")) {
    return 'missing "latestStartedAt" (string | null)';
  }
  if (typeof data.snapshots !== "number") return 'missing "snapshots" (number)';
  return null;
};
const validateScopeWarningsData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of ScopeWarning";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.kind !== "string" || typeof item.message !== "string") {
      return "each warning needs { kind, message, … }";
    }
  }
  return null;
};
const validateCopyFixPromptData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.prompt !== "string") return 'missing "prompt" (string)';
  if (typeof data.failures !== "number") return 'missing "failures" (number)';
  return null;
};
const validateTraceWaterfallData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of TraceWaterfallRow";
  for (const row of data as unknown[]) {
    if (
      !isObject(row) ||
      typeof row.experimentId !== "string" ||
      typeof row.evalId !== "string" ||
      typeof row.locator !== "string" ||
      !("durationMs" in row) ||
      (row.durationMs !== null && typeof row.durationMs !== "number") ||
      !Array.isArray(row.spans)
    ) {
      return "each row needs { experimentId, evalId, locator, durationMs: number | null, spans }";
    }
    for (const span of row.spans as unknown[]) {
      if (!isObject(span) || typeof span.name !== "string" || typeof span.startOffsetMs !== "number") {
        return "each span needs { name, kind, startOffsetMs, durationMs, failed }";
      }
    }
  }
  return null;
};

// ───────────────────────── 站点组件(Hero / PoweredBy / ScopeWarnings / CopyFixPrompt / TraceWaterfall)─────────────────────────

/** `Hero` 的 props:标题缺省取 `ctx.report.title`(回退链后的站点标题)。 */
export interface HeroProps {
  /** 覆盖标题;省略时取 ctx.report.title(回退链后的站点标题)。 */
  title?: LocalizedText;
  className?: string;
}

/** HeroCard 的 data 校验入口(它不经 makeDataComponent,数据形态是唯一形态)。 */
const assertHeroData = (data: unknown): HeroData => {
  const problem = validateHeroData(data);
  if (problem !== null) throw dataShapeError("HeroCard", "heroData", "HeroData", problem);
  return data as HeroData;
};

/**
 * `HeroCard`:Hero 的渲染件,双面组件,只收 data 形态——标题输入是站点声明与 Scope 的
 * 合成物,没有单独的 spec 等价形。web 面渲染 hero 标题(h1)、按渲染 locale 格式化的运行
 * meta(latestStartedAt 为 null 时内置「暂无运行」文案)与品牌行(等同 PoweredBy,恒含、
 * 无拆除 prop);text 面输出标题行与 meta 行,不含品牌行
 * (docs/feature/reports/library/site-components.md「HeroCard」)。
 */
export const HeroCard = defineComponent<HeroCardProps>({
  web: (props, ctx) => {
    assertHeroData(props.data);
    return <HeroCardWeb title={props.title} data={props.data} className={props.className} locale={ctx.locale} />;
  },
  text: (props, ctx) => {
    assertHeroData(props.data);
    return heroCardText(props.title, props.data, ctx);
  },
});
HeroCard.displayName = "HeroCard";

/** `HeroCard` 的 props:标题 + `heroData()` 的产物,只有 data 形态。 */
export interface HeroCardProps {
  title: LocalizedText;
  data: HeroData;
  className?: string;
}

/**
 * `Hero`:页首的站点标题区——标题、最后运行时间、快照合成来源,恒含品牌行。官方组合组件,
 * 与手写 `<HeroCard title={title ?? ctx.report.title} data={await heroData(ctx.scope)} />`
 * 严格等价、没有私有能力;读 `ctx.report` 意味着输出跟随站点,要站点无关的标题区直接用
 * `HeroCard` 显式传值(docs/feature/reports/library/site-components.md「Hero」)。
 */
export const Hero = defineComponent<HeroProps>(async ({ title, className }, ctx) => (
  <HeroCard title={title ?? ctx.report.title} data={await heroData(ctx.scope)} className={className} />
));
Hero.displayName = "Hero";

/**
 * `PoweredBy`:唯一的品牌件,无 props 双面组件。web 面渲染指向 niceeval 官网的一行品牌色
 * 小字(`utm_source=report&utm_medium=powered-by`,`rel` 仅 `noopener` 以保留 Referer);
 * text 面零输出。没有任何配置——品牌契约是「提供一个组件,不给开关」:不想要品牌就不用
 * 这些组件、自己写替代组件(docs/feature/reports/library/site-components.md「PoweredBy」)。
 */
export const PoweredBy = defineComponent<Record<never, never>>({
  web: () => <PoweredByWeb />,
  text: () => "",
});
PoweredBy.displayName = "PoweredBy";

/** `ScopeWarnings` 的 props:spec 形态取宿主 Scope 的 warnings,data 形态收 `ScopeWarning[]`。 */
export type ScopeWarningsProps = DataProps<readonly ScopeWarning[], Record<never, never>, ChromeProps>;

/**
 * `ScopeWarnings`:选择警告区,警告的唯一呈现组件。把 Scope 携带的 `ScopeWarning[]`
 * 按「下一步动作」聚合渲染(带 experimentId 的按实验聚合、非实验作用域按 kind 聚合;
 * integrity 组在前);web 面组头带去重后的可复制命令、明细收原生 `<details>`(总条数 ≤ 3
 * 默认展开),text 面同构但不折叠。空警告集与裸 `Snapshot[]` 输入两面零输出
 * (docs/feature/reports/library/site-components.md「ScopeWarnings」)。
 */
export const ScopeWarnings = makeDataComponent<readonly ScopeWarning[], Record<never, never>, ChromeProps>({
  name: "ScopeWarnings",
  dataFnName: "scopeWarningsData",
  shapeName: "ScopeWarning[]",
  dataFn: (input) => scopeWarningsData(input),
  specKeys: [],
  validate: validateScopeWarningsData,
  web: (props, ctx) =>
    props.data.length === 0 ? null : (
      <ScopeWarningsWeb data={props.data} locale={props.locale ?? ctx.locale} className={props.className} />
    ),
  text: (props, ctx) => scopeWarningsText(props.data, ctx),
}) as unknown as ReportComponent<ScopeWarningsProps>;

/** `CopyFixPrompt` 的 props:spec 形态无选项,data 形态收 `copyFixPromptData()` 的产物。 */
export type CopyFixPromptProps = DataProps<CopyFixPromptData, Record<never, never>, ChromeProps>;

/**
 * `CopyFixPrompt`:把当前范围的全部失败整理成一段可交给 coding agent 的修复 prompt。
 * prompt 在 resolve 阶段算好、烘进静态 HTML,无 JS 时在折叠块里完整可读,「复制」是增强层
 * 行为;`failures` 为 0 时两面零输出;text 面恒零输出——终端里的等价能力是 `show` 的
 * attempt 下钻命令本身(docs/feature/reports/library/site-components.md「CopyFixPrompt」)。
 */
export const CopyFixPrompt = makeDataComponent<CopyFixPromptData, Record<never, never>, ChromeProps>({
  name: "CopyFixPrompt",
  dataFnName: "copyFixPromptData",
  shapeName: "CopyFixPromptData",
  dataFn: (input) => copyFixPromptData(input),
  specKeys: [],
  validate: validateCopyFixPromptData,
  web: (props, ctx) =>
    props.data.failures === 0 ? null : (
      <CopyFixPromptWeb data={props.data} locale={props.locale ?? ctx.locale} className={props.className} />
    ),
  text: () => "",
}) as unknown as ReportComponent<CopyFixPromptProps>;

/** `TraceWaterfall` 的 props:spec 形态无选项,data 形态收 `traceWaterfallData()` 的产物。 */
export type TraceWaterfallProps = DataProps<
  readonly TraceWaterfallRow[],
  Record<never, never>,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;

/**
 * `TraceWaterfall`:每个 attempt 一行的执行时间瀑布,用 canonical OTel 字段显示被测 agent
 * 的原始 span(agent / model / tool)。web 面静态渲染顶层 span 分解条(失败 span 带失败
 * 标记),行链接 attempt 详情;text 面每 attempt 一行(locator、总耗时、span 计数与失败
 * 标记)+ 可复制的 `--timing` 下钻命令。trace 缺失的行照常出现并如实显示缺失;runner
 * 生命周期节点不进瀑布(docs/feature/reports/library/site-components.md「TraceWaterfall」)。
 */
export const TraceWaterfall = makeDataComponent<
  readonly TraceWaterfallRow[],
  Record<never, never>,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "TraceWaterfall",
  dataFnName: "traceWaterfallData",
  shapeName: "TraceWaterfallRow[]",
  dataFn: (input) => traceWaterfallData(input),
  specKeys: [],
  validate: validateTraceWaterfallData,
  web: (props, ctx) => (
    <TraceWaterfallWeb
      data={props.data}
      attemptHref={hrefOf(props, ctx)}
      locale={props.locale ?? ctx.locale}
      className={props.className}
    />
  ),
  text: (props, ctx) => traceWaterfallText(props.data, ctx),
}) as unknown as ReportComponent<TraceWaterfallProps>;
