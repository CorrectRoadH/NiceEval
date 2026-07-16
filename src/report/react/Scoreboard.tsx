// Scoreboard:考试成绩单——总分 + 分科小计。
// 固定分母的口径不藏:没跑的题挣 0 分但留在分母里(notRun),跑了但测不了的题同样按 0 分
// (unscorable),两个计数分开显示,连同 refs 一起,不合并成一个笼统的缺失数;
// weights 是「实际生效的权重表」,渲染出来让成绩单可审计;题集之外被忽略的 eval 数在注脚。

import type { ReactElement } from "react";
import type { ScoreboardData } from "../types.ts";
import { DEFAULT_REPORT_LOCALE, countText, localeText, resolveLocalizedText, type ReportLocale } from "../locale.ts";
import { colorClassForKey } from "./colors.ts";
import { cx } from "./format.ts";

export function Scoreboard({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: ScoreboardData;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  // 科目列 = 各行 subjects 的并集,按首次出现顺序;固定分母下各行本应一致,这里防御性合并
  const subjectKeys: string[] = [];
  for (const row of data.rows) {
    for (const subject of row.subjects) {
      if (!subjectKeys.includes(subject.key)) subjectKeys.push(subject.key);
    }
  }

  return (
    <section className={cx("nre", "nre-scoreboard", className)}>
      <table className="nre-scoreboard-table">
        <thead>
          <tr>
            <th scope="col" className="nre-dimension">
              {data.rowDimension}
            </th>
            <th scope="col" className="nre-total-col">
              {localeText(locale, "scoreboard.total")}
              <span className="nre-full-marks">/ {data.fullMarks}</span>
            </th>
            {subjectKeys.map((key) => (
              <th scope="col" key={key} className="nre-subject-col">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.key}>
              {/* 被打分者(如 agent):稳定散列上色,跨块同键同色 */}
              <th scope="row" className={cx("nre-row-key", "nre-key", colorClassForKey(row.key))}>
                {row.key}
              </th>
              <td className="nre-total">
                {resolveLocalizedText(row.total.display, locale)}
                {/* 两种 0 分分开注脚:没去考(notRun)与考了判不了(unscorable) */}
                {row.total.notRun > 0 && (
                  <span className="nre-total-not-run">{countText(locale, "scoreboard.notRun", row.total.notRun)}</span>
                )}
                {row.total.unscorable > 0 && (
                  <span className="nre-total-unscorable">{countText(locale, "scoreboard.unscorable", row.total.unscorable)}</span>
                )}
              </td>
              {subjectKeys.map((key) => {
                const subject = row.subjects.find((s) => s.key === key);
                if (!subject) return <td key={key} className="nre-td-empty" />;
                return (
                  <td key={key} className="nre-subject">
                    <span
                      className="nre-subject-score"
                      title={localeText(locale, "scoreboard.subjectTitle", {
                        questions: subject.questions,
                        earned: subject.earned,
                        possible: subject.possible,
                      })}
                    >
                      {resolveLocalizedText(subject.display, locale)}
                    </span>
                    {subject.notRun > 0 && (
                      <span className="nre-subject-not-run">{localeText(locale, "scoreboard.notRunText", { n: subject.notRun })}</span>
                    )}
                    {subject.unscorable > 0 && (
                      <span className="nre-subject-unscorable">
                        {localeText(locale, "scoreboard.unscorableText", { n: subject.unscorable })}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* 实际生效的权重表:成绩单可审计 */}
      <p className="nre-weights">
        {localeText(locale, "scoreboard.weights")}{" "}
        {data.weights.length === 0
          ? localeText(locale, "scoreboard.allWeights")
          : data.weights.map((w) => (
              <span key={w.prefix} className="nre-weight">
                {w.prefix} ×{w.weight}
              </span>
            ))}
        {data.weights.length > 0 && <span className="nre-weight-rest">{localeText(locale, "scoreboard.othersWeight")}</span>}
      </p>
      {/* 题集之外的 eval:忽略但如实报数 */}
      {data.ignoredEvals > 0 && (
        <p className="nre-scoreboard-ignored">{countText(locale, "scoreboard.ignored", data.ignoredEvals)}</p>
      )}
    </section>
  );
}
