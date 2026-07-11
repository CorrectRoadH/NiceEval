// MetricTable:行维度 × 指标列。
// 行按传入顺序渲染——排序发生在计算侧(tableData 的 sort 参数),组件不重排;
// 静态 HTML 以数据侧预排的顺序呈现即完整。web 面额外输出渐进增强的 data 属性:
// 所有表头带 data-nre-sort、格子带 data-sort-value,enhance.js 在场时点表头
// 可就地重排(纯展示态交互,不改口径);filter 开时在表格前渲染过滤输入框。
// meta 在场(rows: "experiment")时补 Model / Agent / Verdicts 列,列序对齐 view
// 原生榜单:experiment、model、agent、指标列…、verdicts。
// 列头以箭头标注 better 方向;samples < total 的格子带覆盖率角标;
// 一组全 null 渲染成「缺数据」,绝不画 0(逻辑在 MetricCellView)。

import { Fragment, type ReactElement } from "react";
import type { AttemptRef, MetricColumn, TableData, TableRowMeta, TableSubRow } from "../types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, resolveMetricLabel, type ReportLocale, type ReportMessageKey } from "../locale.ts";
import { MetricCellView } from "./cell.tsx";
import { colorClassForKey } from "./colors.ts";
import { cx } from "./format.ts";

/** verdict 计票 pill(「3 passed / 1 failed」):非零判定各一枚,全零如实空。 */
function VerdictTally({
  verdicts,
  locale,
}: {
  verdicts: NonNullable<TableRowMeta["verdicts"]>;
  locale: ReportLocale;
}): ReactElement {
  const kinds = (["passed", "failed", "errored", "skipped"] as const).filter((k) => verdicts[k] > 0);
  return (
    <span className="nre-verdict-tally">
      {kinds.map((kind) => (
        <span key={kind} className={cx("nre-verdict-pill", `nre-verdict-${kind}`)}>
          {verdicts[kind]} {localeText(locale, `verdict.${kind}`)}
        </span>
      ))}
      {kinds.length === 0 && <span className="nre-missing">—</span>}
    </span>
  );
}

export function MetricTable({
  data,
  attemptHref,
  filter,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: TableData;
  attemptHref?: (ref: AttemptRef) => string;
  filter?: boolean;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const hasMeta = data.rows.some((row) => row.meta !== undefined);
  const hasModel = data.rows.some((row) => row.meta?.model !== undefined);
  const hasVerdicts = data.rows.some((row) => row.meta?.verdicts !== undefined);
  // colSpan 给展开明细那一整行用:1(行键)+ Model/Agent 元列 + 指标列 + Verdicts 列。
  const colCount = 1 + (hasMeta && hasModel ? 1 : 0) + (hasMeta ? 1 : 0) + data.columns.length + (hasVerdicts ? 1 : 0);

  const table = (
    <table className={cx("nre", "nre-metric-table", !filter && className)}>
      <thead>
        <tr>
          <th scope="col" className="nre-dimension" data-nre-sort="">
            {data.dimension}
          </th>
          {hasMeta && hasModel && (
            <th scope="col" className="nre-meta-col" data-nre-sort="">
              {localeText(locale, "table.model")}
            </th>
          )}
          {hasMeta && (
            <th scope="col" className="nre-meta-col" data-nre-sort="">
              {localeText(locale, "table.agent")}
            </th>
          )}
          {data.columns.map((col) => (
            <th scope="col" key={col.key} className="nre-metric-col" data-nre-sort="">
              {resolveMetricLabel(col.label, locale, col.key)}
              {col.unit && <span className="nre-unit">({col.unit})</span>}
              {/* better 方向提示:↑ 越高越好 / ↓ 越低越好 */}
              {col.better && (
                <span
                  className="nre-better"
                  title={localeText(locale, col.better === "higher" ? "table.higherBetter" : "table.lowerBetter")}
                >
                  {col.better === "higher" ? "↑" : "↓"}
                </span>
              )}
            </th>
          ))}
          {hasVerdicts && (
            <th scope="col" className="nre-verdicts-col" data-nre-sort="">
              {localeText(locale, "table.verdicts")}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => {
          const subRows = row.meta?.subRows;
          return (
            <Fragment key={row.key}>
              <tr>
                {/* 行键 = 维度键(如 agent):稳定散列上色,跨块同键同色 */}
                <th
                  scope="row"
                  className={cx("nre-row-key", "nre-key", colorClassForKey(row.key))}
                  data-sort-value={row.key}
                >
                  {row.key}
                  {/* rows: "experiment" 专属:eval/attempt 数 + 最后运行时间,行键下的一行紧凑摘要
                      (旧 ExperimentRow 的 "N eval results · N runs · 最后运行时间") */}
                  {row.meta?.evals !== undefined && (
                    <div className="nre-row-meta-sub">
                      {localeText(locale, "overview.evalsCount", { n: row.meta.evals })}
                      {row.meta.attempts !== undefined && row.meta.attempts > row.meta.evals
                        ? ` · ${localeText(locale, "overview.attemptsCount", { n: row.meta.attempts })}`
                        : ""}
                      {row.meta.lastRunAt ? ` · ${localeText(locale, "latestRun", { run: row.meta.lastRunAt })}` : ""}
                    </div>
                  )}
                </th>
                {hasMeta && hasModel && (
                  <td className="nre-td nre-meta-cell" data-sort-value={row.meta?.model ?? ""}>
                    {row.meta?.model ?? <span className="nre-missing">—</span>}
                  </td>
                )}
                {hasMeta && (
                  <td className="nre-td nre-meta-cell" data-sort-value={row.meta?.agent ?? ""}>
                    {row.meta?.agent ?? <span className="nre-missing">—</span>}
                  </td>
                )}
                {data.columns.map((col) => {
                  const cell = row.cells[col.key];
                  return (
                    <td key={col.key} className="nre-td" data-sort-value={cell?.value ?? ""}>
                      {cell ? (
                        <MetricCellView cell={cell} attemptHref={attemptHref} locale={locale} />
                      ) : (
                        // 数据侧没给这个格子(理论上 tableData 不会缺列)——按空处理,不编数
                        <span className="nre-empty" />
                      )}
                    </td>
                  );
                })}
                {hasVerdicts && (
                  <td className="nre-td nre-verdicts-cell" data-sort-value={row.meta?.verdicts?.passed ?? ""}>
                    {row.meta?.verdicts ? (
                      <VerdictTally verdicts={row.meta.verdicts} locale={locale} />
                    ) : (
                      <span className="nre-missing">—</span>
                    )}
                  </td>
                )}
              </tr>
              {/* expand 展开的子行:零 JS 靠原生 <details>(与 CaseList 的 evidence 同一个姿势),
                  折叠态是「未读」不是「不存在」——排序/过滤不动这一行,它跟着父行走。 */}
              {subRows && subRows.length > 0 && (
                <tr className="nre-subrows-row">
                  <td className="nre-subrows-cell" colSpan={colCount}>
                    <SubRowsDetail subRows={subRows} columns={data.columns} attemptHref={attemptHref} locale={locale} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );

  if (!filter) return table;
  // 过滤输入框渲染在表格前(同一个 wrap 里),enhance.js 经 data-nre-filter 接管;
  // 无 JS 时静默无功能,表格内容依旧完整。
  return (
    <div className={cx("nre", "nre-metric-table-wrap", className)}>
      <input
        className="nre-filter"
        data-nre-filter=""
        type="search"
        placeholder={localeText(locale, "table.filterPlaceholder")}
      />
      {table}
    </div>
  );
}

/**
 * `expand` 展开出的子行明细:零 JS 靠原生 `<details>`(与 CaseList 的 evidence 同一姿势,
 * 折叠态仍在 DOM 里、一次点击可达,满足「静态 HTML 内容完整可读」)。子表复用与父表相同的
 * `MetricCellView` 渲染同一套 columns——子行不是另一种展示,只是维度换了、群体收窄了。
 */
function SubRowsDetail({
  subRows,
  columns,
  attemptHref,
  locale,
}: {
  subRows: TableSubRow[];
  columns: MetricColumn[];
  attemptHref?: (ref: AttemptRef) => string;
  locale: ReportLocale;
}): ReactElement {
  const tally = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const sub of subRows) tally[sub.verdict] += 1;
  return (
    <details className="nre-subrows">
      <summary className="nre-subrows-summary">
        <span>{localeText(locale, "table.viewBreakdown")}</span>
        <VerdictTally verdicts={tally} locale={locale} />
      </summary>
      <table className="nre-subtable">
        <thead>
          <tr>
            <th scope="col" className="nre-subrow-verdict-col">
              {localeText(locale, "table.verdicts")}
            </th>
            <th scope="col" className="nre-subrow-key-col">
              {localeText(locale, "table.eval")}
            </th>
            <th scope="col" className="nre-subrow-reason-col">
              {localeText(locale, "table.reason")}
            </th>
            {columns.map((col) => (
              <th scope="col" key={col.key} className="nre-metric-col">
                {resolveMetricLabel(col.label, locale, col.key)}
              </th>
            ))}
            {attemptHref && <th scope="col" className="nre-subrow-link-col" />}
          </tr>
        </thead>
        <tbody>
          {subRows.map((sub) => (
            <tr key={sub.key} className="nre-subrow">
              <td className="nre-td">
                <span className={cx("nre-subrow-verdict", `nre-verdict-${sub.verdict}`)}>
                  {localeText(locale, `verdict.${sub.verdict}` as ReportMessageKey)}
                </span>
              </td>
              <th scope="row" className="nre-subrow-key">
                {sub.key}
                {sub.runs > 1 && (
                  <span className="nre-subrow-runs" title={`${sub.passedRuns}/${sub.runs} passed`}>
                    {sub.passedRuns}/{sub.runs}
                  </span>
                )}
              </th>
              <td className="nre-td nre-subrow-reason">{sub.reason ?? <span className="nre-missing">—</span>}</td>
              {columns.map((col) => {
                const cell = sub.cells[col.key];
                return (
                  <td key={col.key} className="nre-td">
                    {cell ? (
                      <MetricCellView cell={cell} attemptHref={attemptHref} locale={locale} />
                    ) : (
                      <span className="nre-empty" />
                    )}
                  </td>
                );
              })}
              {attemptHref && (
                <td className="nre-td">
                  <a className="nre-subrow-link" href={attemptHref(sub.ref)}>
                    {localeText(locale, "caseList.viewAttempt")}
                  </a>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
