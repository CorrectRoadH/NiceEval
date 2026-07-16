// ExperimentComparison 的 web 面:完整持有所有可比组,组选择只切换已经独立计算好的 panel。
// 静态 HTML 用原生 <details> 保留每组完整内容(第一组默认展开、无 JS 完整可读);
// enhance.js 再把上方摘要卡变成单选切换。切组是纯浏览状态,不重新计算任何数字。

import type { ReactElement } from "react";
import type { ExperimentComparisonData } from "../types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../locale.ts";
import { ScopeSummary } from "./ScopeSummary.tsx";
import { MetricScatter } from "./MetricScatter.tsx";
import { ExperimentList } from "./ExperimentList.tsx";
import type { AttemptLocator } from "../../results/locator.ts";
import { cx } from "./format.ts";

export function ExperimentComparisonView({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
  attemptHref,
}: {
  data: ExperimentComparisonData;
  className?: string;
  locale?: ReportLocale;
  attemptHref?: (locator: AttemptLocator) => string;
}): ReactElement {
  if (data.groups.length === 0) {
    return (
      <div className={cx("nre", "nre-experiment-comparison", className)}>
        <p className="nre-experiment-groups-empty">{localeText(locale, "experimentComparison.empty")}</p>
      </div>
    );
  }

  return (
    <div className={cx("nre", "nre-experiment-comparison", className)} data-nre-experiment-groups>
      <div
        className="nre-experiment-group-tabs"
        role="tablist"
        aria-label={localeText(locale, "experimentComparison.groups")}
      >
        {data.groups.map((group, index) => (
          <div
            key={group.key}
            className="nre-experiment-group-tab"
            role="tab"
            tabIndex={index === 0 ? 0 : -1}
            aria-selected={index === 0 ? "true" : "false"}
            aria-label={localeText(locale, "experimentComparison.selectGroup", { group: group.key })}
            data-nre-experiment-group-select={index}
          >
            <strong className="nre-experiment-group-name">{group.key}</strong>
            <ScopeSummary data={group.summary} locale={locale} />
          </div>
        ))}
      </div>

      <div className="nre-experiment-group-panels">
        {data.groups.map((group, index) => (
          <details
            key={group.key}
            className="nre-experiment-group-panel"
            data-nre-experiment-group-panel={index}
            role="tabpanel"
            open={index === 0}
          >
            <summary>{group.key}</summary>
            <MetricScatter data={group.scatter} locale={locale} />
            <ExperimentList data={group.experiments} filter locale={locale} relativeTo={group.key} attemptHref={attemptHref} />
          </details>
        ))}
      </div>
    </div>
  );
}
