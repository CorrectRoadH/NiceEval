// MetricLine:趋势线——x 是 experiment 声明的 flag(有序变量),每个系列一条线。
// 与 MetricScatter 的分工:scatter 的两轴都是测出来的指标(找 frontier),
// line 的 x 是你配置的变量(看趋势)。x 轴正常升序;y 轴向随 better;
// x 或 y 缺数据的点不画,注脚如实报数;每个点带 <title> hover(enhance.js 在场时
// 升级为样式化 tooltip),可经 pointHref 下钻。配色走类名(nre-series-cN)由 CSS
// 上色,深色主题跟随,不留内联 hex。

import type { ReactElement } from "react";
import type { LineData } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, countText, localeText, resolveLocalizedText, resolveMetricLabel, type ReportLocale } from "../../model/locale.ts";
import { colorIndicesForKeys } from "../../assets/colors.ts";
import { cx } from "../shared.ts";

const WIDTH = 640;
const HEIGHT = 360;
const PLOT = { left: 64, right: WIDTH - 140, top: 24, bottom: HEIGHT - 56 };

interface DrawablePoint {
  key: string;
  series?: string;
  xValue: number;
  yValue: number;
  title: string;
  px: number;
  py: number;
}

function linearScale(values: number[], pixelLo: number, pixelHi: number, invert: boolean) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 2;
  const padded = { lo: lo - (hi - lo ? span * 0.08 : 1), hi: hi + (hi - lo ? span * 0.08 : 1) };
  const scale = (v: number) => {
    let t = (v - padded.lo) / (padded.hi - padded.lo);
    if (invert) t = 1 - t;
    return pixelLo + t * (pixelHi - pixelLo);
  };
  return { lo, hi, scale };
}

export function MetricLine({
  data,
  pointHref,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: LineData;
  pointHref?: (row: LineData["rows"][number]) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const missing = data.rows.filter((r) => r.x === null || r.y.value === null);
  const drawableRows = data.rows.filter((r) => r.x !== null && r.y.value !== null);
  const yLabel = resolveMetricLabel(data.y.label, locale, data.y.key);
  const xLabel = resolveMetricLabel(data.x.label, locale, data.x.key);

  const missingNote =
    missing.length > 0 ? (
      <p className="nre-line-missing" title={missing.map((r) => r.key).join(", ")}>
        {countText(locale, "pointsMissing", missing.length)}
      </p>
    ) : null;

  if (drawableRows.length === 0) {
    return (
      <figure className={cx("nre", "nre-metric-line", className)}>
        <p className="nre-missing">{localeText(locale, "cell.missing")}</p>
        {missingNote}
      </figure>
    );
  }

  const xScale = linearScale(drawableRows.map((r) => r.x as number), PLOT.left, PLOT.right, false);
  // y 像素轴向下增长:higher 高值在上;lower 反向后「好」的一端同样在上
  const yScale = linearScale(
    drawableRows.map((r) => r.y.value as number),
    PLOT.bottom,
    PLOT.top,
    data.y.better === "lower",
  );

  const points: DrawablePoint[] = drawableRows.map((r) => ({
    key: r.key,
    series: r.series,
    xValue: r.x as number,
    yValue: r.y.value as number,
    title: `${r.key}\n${xLabel}: ${resolveLocalizedText(r.xDisplay, locale)}\n${yLabel}: ${resolveLocalizedText(r.y.display, locale)}(${r.y.samples}/${r.y.total})`,
    px: xScale.scale(r.x as number),
    py: yScale.scale(r.y.value as number),
  }));

  // 同系列的点按 x 排序连线;系列名标在最右点旁
  const seriesOrder: string[] = [];
  const bySeries = new Map<string, DrawablePoint[]>();
  for (const p of points) {
    const key = p.series ?? "";
    if (!bySeries.has(key)) {
      bySeries.set(key, []);
      seriesOrder.push(key);
    }
    bySeries.get(key)!.push(p);
  }
  for (const list of bySeries.values()) list.sort((a, b) => a.xValue - b.xValue);
  // 同图撞色消解:散列格作起点,按图例顺序线性探测空格(colors.ts 的契约注释)
  const colorIdx = colorIndicesForKeys(seriesOrder.filter((s) => s !== ""));
  const seriesClassOf = (series: string) => (series === "" ? "nre-series-none" : `nre-series-c${colorIdx.get(series) ?? 0}`);

  const xTicks = xScale.lo === xScale.hi ? [xScale.lo] : [xScale.lo, xScale.hi];
  const yTicks = yScale.lo === yScale.hi ? [yScale.lo] : [yScale.lo, yScale.hi];
  const xDisplayFor = (value: number) => {
    const row = drawableRows.find((r) => r.x === value);
    return row === undefined ? String(value) : resolveLocalizedText(row.xDisplay, locale);
  };
  const yDisplayFor = (value: number) => {
    const row = drawableRows.find((r) => r.y.value === value);
    return row === undefined ? String(value) : resolveLocalizedText(row.y.display, locale);
  };

  return (
    <figure className={cx("nre", "nre-metric-line", className)}>
      <svg
        className="nre-line-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${yLabel} by ${xLabel}`}
      >
        <rect
          className="nre-line-plot"
          x={PLOT.left}
          y={PLOT.top}
          width={PLOT.right - PLOT.left}
          height={PLOT.bottom - PLOT.top}
          fill="none"
        />
        <text className="nre-line-xlabel" x={(PLOT.left + PLOT.right) / 2} y={HEIGHT - 8} textAnchor="middle">
          {xLabel}
          {data.x.unit ? `(${data.x.unit})` : ""}
        </text>
        <text
          className="nre-line-ylabel"
          x={16}
          y={(PLOT.top + PLOT.bottom) / 2}
          textAnchor="middle"
          transform={`rotate(-90 16 ${(PLOT.top + PLOT.bottom) / 2})`}
        >
          {yLabel}
          {data.y.unit ? `(${data.y.unit})` : ""}
        </text>

        {xTicks.map((v) => (
          <text key={`x${v}`} className="nre-line-tick" x={xScale.scale(v)} y={PLOT.bottom + 16} textAnchor="middle">
            {xDisplayFor(v)}
          </text>
        ))}
        {yTicks.map((v) => (
          <text key={`y${v}`} className="nre-line-tick" x={PLOT.left - 6} y={yScale.scale(v) + 4} textAnchor="end">
            {yDisplayFor(v)}
          </text>
        ))}

        {seriesOrder.map((series) => {
          const list = bySeries.get(series)!;
          const seriesClass = seriesClassOf(series);
          const labelAt = list.reduce((a, b) => (b.px > a.px ? b : a));
          return (
            <g key={series || "(single)"} className={cx("nre-line-series", seriesClass)} data-series={series || undefined}>
              {list.length > 1 && (
                <polyline
                  className="nre-line-path"
                  points={list.map((p) => `${p.px},${p.py}`).join(" ")}
                  fill="none"
                />
              )}
              {series !== "" && (
                <text className="nre-line-series-label" x={labelAt.px + 8} y={labelAt.py + 4}>
                  {series}
                </text>
              )}
            </g>
          );
        })}

        {points.map((p, i) => {
          const circle = (
            <circle
              className={cx("nre-line-point", p.series !== undefined ? seriesClassOf(p.series) : "nre-series-none")}
              data-key={p.key}
              cx={p.px}
              cy={p.py}
              r={4}
            >
              <title>{p.title}</title>
            </circle>
          );
          const row = drawableRows[i];
          return pointHref ? (
            <a key={`${p.key}:${i}`} className="nre-line-point-link" href={pointHref(row)}>
              {circle}
            </a>
          ) : (
            <g key={`${p.key}:${i}`}>{circle}</g>
          );
        })}
      </svg>
      {missingNote}
    </figure>
  );
}
