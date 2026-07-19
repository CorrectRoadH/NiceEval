// DeltaTable:成对对比(B 相对 A)。每格三个值:A、B、Δ;
// Δ 的涨跌好坏由数据侧算好的 outcome 驱动配色(涨不一定是好——成本涨了是坏);
// 任一侧缺数据时 Δ 显示为缺,不硬算(数据侧已给 delta: null / outcome: "unavailable")。
// 0 对不是错误:派生形态(pairsByFlag)配不出对时显示明确空态并报告配对域实验数。

import type { ReactElement } from "react";
import type { DeltaData } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, resolveLocalizedText, resolveMetricLabel, type ReportLocale } from "../../model/locale.ts";
import { MetricCellView } from "../cell.tsx";
import { colorClassForKey } from "../../assets/colors.ts";
import { cx } from "../shared.ts";

const OUTCOME_CLASS: Record<string, string> = {
  improved: "nre-delta-good",
  regressed: "nre-delta-bad",
  unchanged: "nre-delta-flat",
  unavailable: "nre-delta-missing",
};

export function DeltaTable({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: DeltaData;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  if (data.rows.length === 0) {
    return (
      <div className={cx("nre", "nre-delta-table-empty", className)}>
        <p className="nre-missing">
          {localeText(locale, "delta.empty", { experiments: data.experiments ?? 0 })}
        </p>
      </div>
    );
  }
  return (
    <table className={cx("nre", "nre-delta-table", className)}>
      <thead>
        <tr>
          <th scope="col" className="nre-dimension">
            {localeText(locale, "delta.pairHeader")}
          </th>
          {data.columns.map((col) => (
            <th scope="col" key={col.key} className="nre-metric-col">
              {resolveMetricLabel(col.label, locale, col.key)}
              {col.unit && <span className="nre-unit">({col.unit})</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => {
          const label = resolveLocalizedText(row.label, locale);
          return (
            <tr key={row.key}>
              <th scope="row" className="nre-pair">
                {/* pair 的 label:作者声明(或派生规则生成)原样透传;稳定散列上色 */}
                <span className={cx("nre-row-key", "nre-key", colorClassForKey(label))}>{label}</span>
                <span className="nre-pair-ids">
                  {row.a.key} → {row.b.key}
                </span>
              </th>
              {data.columns.map((col) => {
                const cell = row.cells[col.key];
                if (!cell) return <td key={col.key} className="nre-td-empty" />;
                return (
                  <td key={col.key} className="nre-delta-cell">
                    {/* A/B 走统一的 MetricCellView:缺数据文案与覆盖率角标同一套 */}
                    <span className="nre-delta-side nre-delta-a">
                      <span className="nre-delta-tag">A</span>
                      <MetricCellView cell={cell.a} locale={locale} />
                    </span>
                    <span className="nre-delta-side nre-delta-b">
                      <span className="nre-delta-tag">B</span>
                      <MetricCellView cell={cell.b} locale={locale} />
                    </span>
                    <span
                      className={cx("nre-delta-side", "nre-delta-d", OUTCOME_CLASS[cell.outcome])}
                      data-outcome={cell.outcome}
                    >
                      <span className="nre-delta-tag">Δ</span>
                      {/* 任一侧 null → delta null:显示缺,不硬算 */}
                      {cell.delta === null ? (
                        <span className="nre-missing">{localeText(locale, "cell.missing")}</span>
                      ) : (
                        resolveLocalizedText(cell.display, locale)
                      )}
                    </span>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
