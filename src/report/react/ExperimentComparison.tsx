// ExperimentComparison 的 web 面:对完整 Scope 渲染一份摘要、一张散点与一份实验列表——
// 不同深度目录的 experiments 一律同屏,不再有组选择器 / tab / panel。

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
  connect,
  className,
  locale = DEFAULT_REPORT_LOCALE,
  attemptHref,
}: {
  data: ExperimentComparisonData;
  /** 透传给散点;缺省跟随缺省 series 解析——按 line 归类时连线(声明了线就画线)。 */
  connect?: boolean;
  className?: string;
  locale?: ReportLocale;
  attemptHref?: (locator: AttemptLocator) => string;
}): ReactElement {
  if (data.experiments.length === 0) {
    return (
      <div className={cx("nre", "nre-experiment-comparison", className)}>
        <p className="nre-experiment-comparison-empty">{localeText(locale, "experimentComparison.empty")}</p>
      </div>
    );
  }

  return (
    <div className={cx("nre", "nre-experiment-comparison", className)}>
      <ScopeSummary data={data.summary} locale={locale} />
      <MetricScatter data={data.scatter} connect={connect ?? data.scatter.seriesDimension === "line"} locale={locale} />
      <ExperimentList data={data.experiments} filter locale={locale} attemptHref={attemptHref} />
    </div>
  );
}
