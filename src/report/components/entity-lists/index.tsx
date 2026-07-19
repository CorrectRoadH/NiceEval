// 官方双面组件的装配点:web 面(./ExperimentList.tsx / EvalList.tsx / AttemptList.tsx 的纯
// React 组件)+ text 面(./faces.ts)+ resolve 解析面(spec 形态由管线代调配套 ./compute.ts)。
// FailureList 是组合组件,内部就是 attemptListData → 过滤 → AttemptList data 形态,不产生
// 自己的 data。

import { defineComponent, type ReportComponent } from "../../definition/tree.ts";
import type { AttemptListItem, EvalListItem, ExperimentListItem, ReportInput } from "../../model/types.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import { collectItems, locatorOf, resolveInput } from "../../model/aggregate.ts";
import type { ReportLocale } from "../../model/locale.ts";
import {
  isCell,
  isObject,
  isTally,
  makeDataComponent,
  hrefOf,
  type ChromeProps,
  type DataProps,
  type Validator,
} from "../shared.ts";
import { attemptListData, evalListData, experimentListData } from "./compute.ts";
import { attemptListText, evalListText, experimentListText } from "./faces.ts";
import { AttemptList as AttemptListWeb } from "./AttemptList.tsx";
import { EvalList as EvalListWeb } from "./EvalList.tsx";
import { ExperimentList as ExperimentListWeb } from "./ExperimentList.tsx";

const validateExperimentListData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of ExperimentListItem";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.experimentId !== "string" || !isTally(item.evalVerdicts) || !isCell(item.endToEndPassRate)) {
      return "each item needs { experimentId, evalVerdicts, endToEndPassRate, costUSD, durationMs, tokens, evalRows, … }";
    }
  }
  return null;
};
const validateEvalListData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of EvalListItem";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.evalId !== "string" || !isCell(item.examScore) || !Array.isArray(item.attempts)) {
      return "each item needs { experimentId, evalId, verdict, examScore, durationMs, costUSD, attempts }";
    }
  }
  return null;
};
const validateAttemptListData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of AttemptListItem";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.evalId !== "string" || !("failureSummary" in item) || !("costUSD" in item)) {
      return "each item needs { experimentId, evalId, verdict, failureSummary, moreFailures, examScore, durationMs, costUSD, locator }";
    }
  }
  return null;
};

// ───────────────────────── 实体列表 ─────────────────────────

interface EntityListChrome extends ChromeProps {
  attemptHref?: (locator: AttemptLocator) => string;
}

export type ExperimentListProps = DataProps<
  readonly ExperimentListItem[],
  Record<never, never>,
  EntityListChrome & {
    /** web 面在比较表前显示实验过滤框;text 面忽略。 */
    filter?: boolean;
    /**
     * 可选父路径:两面的行标签去掉与它相同的前缀,只显示 experiment id 末段。自定义报告
     * 显式传入使用;默认 `ExperimentComparison` 不传,完整 id 始终可见。完整 id 仍是
     * 排序 / 着色 / 过滤 / 折叠的键。
     */
    relativeTo?: string;
  }
>;

/** 实验列表:每项一个 experiment,固定八列比较表 + 展开到 Eval / Attempt。 */
export const ExperimentList = makeDataComponent<
  readonly ExperimentListItem[],
  Record<never, never>,
  EntityListChrome & { filter?: boolean; relativeTo?: string }
>({
  name: "ExperimentList",
  dataFnName: "experimentListData",
  shapeName: "ExperimentListItem[]",
  dataFn: (input) => experimentListData(input),
  specKeys: [],
  validate: validateExperimentListData,
  web: (props, ctx) => (
    <ExperimentListWeb
      data={props.data}
      filter={props.filter}
      relativeTo={props.relativeTo}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => experimentListText(props.data, ctx, props.relativeTo),
}) as unknown as ReportComponent<ExperimentListProps>;

export type EvalListProps = DataProps<readonly EvalListItem[], Record<never, never>, EntityListChrome>;

/** Eval 列表:每项一个 experimentId + evalId,展开到这道题的 Attempt。 */
export const EvalList = makeDataComponent<readonly EvalListItem[], Record<never, never>, EntityListChrome>({
  name: "EvalList",
  dataFnName: "evalListData",
  shapeName: "EvalListItem[]",
  dataFn: (input) => evalListData(input),
  specKeys: [],
  validate: validateEvalListData,
  web: (props, ctx) => (
    <EvalListWeb
      data={props.data}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => evalListText(props.data, ctx),
}) as unknown as ReportComponent<EvalListProps>;

export type AttemptListProps = DataProps<
  readonly AttemptListItem[],
  Record<never, never>,
  EntityListChrome & {
    /** 过滤 / 截断前的总数;省略时等于 data 长度。 */
    total?: number;
    /** web 面加过滤输入框(按 experiment、eval、agent、verdict 或摘要文本收窄行);渐进增强,不改变数据与 text 面。 */
    filter?: boolean;
  }
>;

/** Attempt 列表:实体列表的叶子层,每项一次 attempt 的判定、单行摘要与 locator。 */
export const AttemptList = makeDataComponent<
  readonly AttemptListItem[],
  Record<never, never>,
  EntityListChrome & { total?: number; filter?: boolean }
>({
  name: "AttemptList",
  dataFnName: "attemptListData",
  shapeName: "AttemptListItem[]",
  dataFn: (input) => attemptListData(input),
  specKeys: [],
  validate: validateAttemptListData,
  web: (props, ctx) => (
    <AttemptListWeb
      data={props.data}
      total={props.total}
      filter={props.filter}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => attemptListText(props.data, props.total, ctx),
}) as unknown as ReportComponent<AttemptListProps>;

// ───────────────────────── FailureList(官方组合件)─────────────────────────

export interface FailureListProps {
  /** 显示的最大条数;默认 20。 */
  limit?: number;
  /** 默认宿主注入的 Scope。 */
  input?: ReportInput;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

/**
 * 「现在有哪些失败要处理」的成品组合件:内部就是 attemptListData → 过滤 → AttemptList
 * data 形态,与手写组合严格等价、没有私有能力(docs/feature/reports/library/entity-lists.md)。
 * verdict ∈ failed / errored,按 attempt 开始时间降序(同刻按 locator 字典序),
 * 截断到 limit(默认 20),total 报告截断前总数。
 */
export const FailureList = defineComponent<FailureListProps>(async (props, ctx) => {
  const input = props.input ?? ctx.scope;
  const all = await attemptListData(input);
  // attempt 开始时间不在列表条目里(它不是列表展示字段);从同一 input 的读取面按 locator 对回。
  const startedAtByLocator = new Map<string, string>();
  for (const item of collectItems(resolveInput(input).snapshots)) {
    startedAtByLocator.set(locatorOf(item), item.attempt.result.startedAt ?? "");
  }
  const failures = all
    .filter((item) => item.verdict === "failed" || item.verdict === "errored")
    .sort((a, b) => {
      const ta = startedAtByLocator.get(a.locator) ?? "";
      const tb = startedAtByLocator.get(b.locator) ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1; // 最近的失败在前
      return a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0;
    });
  const limit = props.limit ?? 20;
  return (
    <AttemptList
      data={failures.slice(0, limit)}
      total={failures.length}
      attemptHref={props.attemptHref}
      locale={props.locale}
      className={props.className}
    />
  );
});
FailureList.displayName = "FailureList";
