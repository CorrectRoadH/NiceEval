// AttemptList:实体列表的叶子层——每项一个 Attempt,固定展示判定、算好的单行结果摘要
// (failureSummary)与证据引用(locator)。完整 assertions / evidence 只经 locator 下钻;
// 渲染面只做宽度截断,不重算摘要。它不预设只看失败,报告作者过滤 data、用 .slice() 限量,
// total 让渲染面如实报告剩余数量,不静默截断。
// ExperimentList / EvalList 的下钻数组是同一个 AttemptListItem[],这里的渲染逻辑因此
// 也是它们展开区里"逐条 attempt"那一层的唯一实现(通过 AttemptRow 导出复用,不重写一遍)。

import type { ReactElement } from "react";
import type { AttemptListItem } from "../types.ts";
import type { AttemptLocator } from "../../results/locator.ts";
import { DEFAULT_REPORT_LOCALE, countText, localeText, type ReportLocale } from "../locale.ts";
import { colorClassForKey } from "./colors.ts";
import { cx, formatDurationMs, formatUSD, verdictMark } from "./format.ts";

const DEFAULT_ATTEMPT_HREF = (locator: AttemptLocator): string => `#/attempt/${locator}`;

/** locator + 判定符的普通 <a>,AttemptList/EvalList/ExperimentList 共用。 */
export function AttemptLocatorBadge({
  item,
  attemptHref = DEFAULT_ATTEMPT_HREF,
}: {
  item: Pick<AttemptListItem, "locator" | "verdict">;
  attemptHref?: (locator: AttemptLocator) => string;
}): ReactElement {
  return (
    <a
      className={cx("nre-locator", `nre-verdict-${item.verdict}`)}
      href={attemptHref(item.locator)}
    >
      {item.locator}
      <span className="nre-locator-mark">{verdictMark(item.verdict)}</span>
    </a>
  );
}

/** failureSummary + moreFailures 的展示形态:摘要原样,+N 计数由 moreFailures 驱动。 */
export function failureSummaryText(item: Pick<AttemptListItem, "failureSummary" | "moreFailures">, locale: ReportLocale): string | null {
  if (item.failureSummary === null) return null;
  return item.moreFailures > 0
    ? `${item.failureSummary} · ${countText(locale, "entityList.moreFailures", item.moreFailures)}`
    : item.failureSummary;
}

/** 一条 Attempt 的比较卡片;完整 assertions 通过 locator 下钻,不在列表内展开。 */
export function AttemptRow({
  item,
  attemptHref = DEFAULT_ATTEMPT_HREF,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  item: AttemptListItem;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
}): ReactElement {
  const reason = failureSummaryText(item, locale);
  return (
    <li className={cx("nre-attempt", `nre-attempt-${item.verdict}`)}>
      <div className="nre-attempt-head">
        <AttemptLocatorBadge item={item} attemptHref={attemptHref} />
        <span className="nre-attempt-eval">{item.evalId}</span>
        <span className="nre-attempt-experiment">{item.experimentId}</span>
        {/* agent 键:稳定散列上色,与其它块(MetricMatrix 列头、DeltaTable 行…)同键同色 */}
        <span className={cx("nre-attempt-agent", "nre-key", colorClassForKey(item.agent))}>{item.agent}</span>
        <span className="nre-attempt-duration">{formatDurationMs(item.durationMs)}</span>
        {/* costUSD 缺失一律 null(测不了),不显示也不伪造 0 */}
        {item.costUSD !== null && <span className="nre-attempt-cost">{formatUSD(item.costUSD)}</span>}
      </div>
      {reason && <p className="nre-attempt-result">{reason}</p>}
    </li>
  );
}

export function AttemptList({
  data,
  total,
  attemptHref = DEFAULT_ATTEMPT_HREF,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: readonly AttemptListItem[];
  /** data 被 slice 时的原始数量;如实显示还剩多少条没展示。 */
  total?: number;
  attemptHref?: (locator: AttemptLocator) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const remaining = (total ?? data.length) - data.length;
  return (
    <section className={cx("nre", "nre-attempt-list", className)}>
      {data.length === 0 && <p className="nre-attempt-list-empty">{localeText(locale, "attemptList.empty")}</p>}
      <ul className="nre-attempts">
        {data.map((item) => (
          <AttemptRow key={item.locator} item={item} attemptHref={attemptHref} locale={locale} />
        ))}
      </ul>
      {remaining > 0 && (
        <p className="nre-truncated">{localeText(locale, "attemptList.truncated", { n: remaining })}</p>
      )}
    </section>
  );
}
