// MetricScatter:质量 × 成本 frontier 的积木,内联 SVG、零图表库、零 hooks。
// 轴向随 better:"lower" 的轴反向画,「好」的角落恒在右上(成本轴 $20 → $0 就是这么来的);
// niceTicks 刻度 + 网格线;每个点直接标注(placePointLabels 候选位择优:避开其它标签、
// 数据点与画布边界,离开左右紧邻位时补 leader line);
// 同系列的点按 x 值排序连线,系列图例列在图下。x 或 y 为 null 的点不画,
// 底部注脚如实报「n 个点缺数据」;hover 信息退化为 SVG <title>,不 hydrate 也在
// (enhance.js 在场时升级为样式化 tooltip)。配色走类名(nre-series-cN)由 CSS 上色,
// 深色主题下图表随令牌切换,不留内联 hex。

import type { ReactElement } from "react";
import type { MetricColumn, ScatterData } from "../types.ts";
import { formatMetricValue } from "../format.ts";
import { DEFAULT_REPORT_LOCALE, countText, localeText, resolveLocalizedText, resolveMetricLabel, type ReportLocale } from "../locale.ts";
import { niceTicks, placePointLabels } from "./chart-math.ts";
import { colorClassForKey, seriesClassForKey } from "./colors.ts";
import { cx } from "./format.ts";

const WIDTH = 640;
const HEIGHT = 360;
const MARGIN = { top: 26, right: 24, bottom: 46, left: 62 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

/** 可画的点:x/y 都有值。组件内部的整理结果,不改数据。 */
interface DrawablePoint {
  key: string;
  series?: string;
  label: string;
  xValue: number;
  yValue: number;
  title: string;
  px: number;
  py: number;
}

/**
 * 点的直接标签:末段在当前 data 中唯一才缩成末段;重名时逐步加长为能区分它们的最短
 * 路径后缀(完整 id 与两轴值仍进 <title>)。
 */
function pointLabels(keys: readonly string[]): Map<string, string> {
  const segsOf = (key: string) => key.split("/").filter(Boolean);
  const depth = new Map<string, number>(keys.map((key) => [key, 1]));
  for (;;) {
    const byLabel = new Map<string, string[]>();
    for (const key of keys) {
      const segs = segsOf(key);
      const label = segs.slice(-Math.min(depth.get(key)!, segs.length)).join("/") || key;
      byLabel.set(label, [...(byLabel.get(label) ?? []), key]);
    }
    let grew = false;
    for (const group of byLabel.values()) {
      if (group.length < 2) continue;
      for (const key of group) {
        const segs = segsOf(key);
        if (depth.get(key)! < segs.length) {
          depth.set(key, depth.get(key)! + 1);
          grew = true;
        }
      }
    }
    if (!grew) {
      const out = new Map<string, string>();
      for (const key of keys) {
        const segs = segsOf(key);
        out.set(key, segs.slice(-Math.min(depth.get(key)!, segs.length)).join("/") || key);
      }
      return out;
    }
  }
}

/**
 * 一根轴:niceTicks 撑出整齐的值域,值 → 像素做线性映射。轴不反向——「好」的方向
 * 由角落提示文案如实说明(成本 × 成功率下是「越靠左上越好」),不虚构轴向。
 */
function axisScale(values: number[], pixelLo: number, pixelHi: number) {
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 5);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const scale = (v: number) => {
    const t = (v - lo) / (hi - lo || 1);
    return pixelLo + t * (pixelHi - pixelLo);
  };
  return { ticks, scale };
}

/** 「好」的角落:x/y 的 better 方向共同决定(缺省按 higher)。 */
export function betterCornerKey(
  xBetter: MetricColumn["better"],
  yBetter: MetricColumn["better"],
): "scatter.betterUpperRight" | "scatter.betterUpperLeft" | "scatter.betterLowerRight" | "scatter.betterLowerLeft" {
  const right = xBetter !== "lower";
  const up = yBetter !== "lower";
  if (up && right) return "scatter.betterUpperRight";
  if (up && !right) return "scatter.betterUpperLeft";
  if (!up && right) return "scatter.betterLowerRight";
  return "scatter.betterLowerLeft";
}

export function MetricScatter({
  data,
  pointHref,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: ScatterData;
  pointHref?: (row: ScatterData["rows"][number]) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const missing = data.rows.filter((r) => r.x.value === null || r.y.value === null);
  const drawableRows = data.rows.filter((r) => r.x.value !== null && r.y.value !== null);

  const missingNote =
    missing.length > 0 ? (
      <p className="nre-scatter-missing" title={missing.map((r) => r.key).join(", ")}>
        {countText(locale, "pointsMissing", missing.length)}
      </p>
    ) : null;

  const xLabel = resolveMetricLabel(data.x.label, locale, data.x.key);
  const yLabel = resolveMetricLabel(data.y.label, locale, data.y.key);

  // 0 个可画点:x/y 指标没有可用数据 —— 明确说缺哪两个指标,不画一张空坐标系
  // (与表格的「绝不画 0」同态度)。
  if (drawableRows.length === 0) {
    return (
      <figure className={cx("nre", "nre-metric-scatter", className)}>
        <p className="nre-scatter-empty nre-missing">{localeText(locale, "scatter.noData", { x: xLabel, y: yLabel })}</p>
        {missingNote}
      </figure>
    );
  }

  const axisLabel = (label: string, col: MetricColumn) => `${label}${col.unit ? `(${col.unit})` : ""}`;

  const xScale = axisScale(drawableRows.map((r) => r.x.value as number), MARGIN.left, MARGIN.left + PLOT_W);
  // y 像素轴向下增长:高值在上 → 映射到 [bottom, top]
  const yScale = axisScale(drawableRows.map((r) => r.y.value as number), MARGIN.top + PLOT_H, MARGIN.top);
  const labelByKey = pointLabels(drawableRows.map((r) => r.key));
  const cornerKey = betterCornerKey(data.x.better, data.y.better);
  const cornerLeft = cornerKey === "scatter.betterUpperLeft" || cornerKey === "scatter.betterLowerLeft";

  const points: DrawablePoint[] = drawableRows.map((r) => {
    const xValue = r.x.value as number;
    const yValue = r.y.value as number;
    return {
      key: r.key,
      series: r.series,
      label: labelByKey.get(r.key) ?? r.key,
      xValue,
      yValue,
      // hover 内容:experiment(点键)+ 系列(有则加一行)+ 两轴 display 与 samples/total
      title: `${r.key}${r.series !== undefined ? `\n${r.series}` : ""}\n${xLabel}: ${resolveLocalizedText(r.x.display, locale)}(${r.x.samples}/${r.x.total})\n${yLabel}: ${resolveLocalizedText(r.y.display, locale)}(${r.y.samples}/${r.y.total})`,
      px: xScale.scale(xValue),
      py: yScale.scale(yValue),
    };
  });

  // 同系列的点按 x 值排序连线;无系列的点只画点不连线
  const seriesOrder: string[] = [];
  const bySeries = new Map<string, DrawablePoint[]>();
  for (const p of points) {
    if (p.series === undefined) continue;
    if (!bySeries.has(p.series)) {
      bySeries.set(p.series, []);
      seriesOrder.push(p.series);
    }
    bySeries.get(p.series)!.push(p);
  }
  for (const list of bySeries.values()) list.sort((a, b) => a.xValue - b.xValue);

  // 直接标签的候选位择优布局:锚向、避让方向都由布局按空间决定,画布边界含边距
  const labels = placePointLabels(
    points.map((p) => ({ cx: p.px, cy: p.py, width: p.label.length * 6.4 + 10 })),
    { x0: 2, y0: 2, x1: WIDTH - 2, y1: HEIGHT - 2 },
  );

  return (
    <figure className={cx("nre", "nre-metric-scatter", className)}>
      <svg
        className="nre-scatter-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${axisLabel(xLabel, data.x)} × ${axisLabel(yLabel, data.y)}`}
      >
        {/* 网格:niceTicks 的整齐刻度线,颜色走 CSS(var(--line)) */}
        <g className="nre-scatter-grid">
          {yScale.ticks.map((tick) => (
            <line key={`gy${tick}`} x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={yScale.scale(tick)} y2={yScale.scale(tick)} />
          ))}
          {xScale.ticks.map((tick) => (
            <line key={`gx${tick}`} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} x1={xScale.scale(tick)} x2={xScale.scale(tick)} />
          ))}
        </g>

        {/* 「好」的角落随 better 方向如实标注(成本 × 成功率下是「越靠左上越好」) */}
        <text
          className="nre-scatter-better-hint"
          x={cornerLeft ? MARGIN.left + 6 : MARGIN.left + PLOT_W - 6}
          y={cornerKey.includes("Upper") ? MARGIN.top + 14 : MARGIN.top + PLOT_H - 8}
          textAnchor={cornerLeft ? "start" : "end"}
        >
          {localeText(locale, cornerKey)}
        </text>

        {/* 刻度:已格式化的整齐值(formatMetricValue 与计算侧同一套) */}
        <g className="nre-scatter-axis nre-scatter-axis-y">
          {yScale.ticks.map((tick) => (
            <text key={`ay${tick}`} className="nre-scatter-tick" x={MARGIN.left - 8} y={yScale.scale(tick) + 3} textAnchor="end">
              {formatMetricValue(tick, data.y.unit)}
            </text>
          ))}
        </g>
        <g className="nre-scatter-axis nre-scatter-axis-x">
          {xScale.ticks.map((tick) => (
            <text key={`ax${tick}`} className="nre-scatter-tick" x={xScale.scale(tick)} y={MARGIN.top + PLOT_H + 16} textAnchor="middle">
              {formatMetricValue(tick, data.x.unit)}
            </text>
          ))}
        </g>

        {/* 轴标签 */}
        <text className="nre-scatter-xlabel" x={MARGIN.left + PLOT_W / 2} y={HEIGHT - 8} textAnchor="middle">
          {axisLabel(xLabel, data.x)}
        </text>
        <text
          className="nre-scatter-ylabel"
          x={14}
          y={MARGIN.top + PLOT_H / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${MARGIN.top + PLOT_H / 2})`}
        >
          {axisLabel(yLabel, data.y)}
        </text>

        {/* 系列连线:类名上色(nre-series-cN),深色主题跟随 */}
        {seriesOrder.map((series) => {
          const list = bySeries.get(series)!;
          if (list.length < 2) return null;
          return (
            <polyline
              key={series}
              className={cx("nre-scatter-line", seriesClassForKey(series))}
              data-series={series}
              points={list.map((p) => `${p.px},${p.py}`).join(" ")}
              fill="none"
            />
          );
        })}

        {/* 点:g 内带 <title>(无 JS 的原生 hover)、直接标签与 leader line;
            pointHref 时包普通 <a>,静态导出也能下钻 */}
        {points.map((p, i) => {
          const label = labels[i];
          const group = (
            <g
              className={cx("nre-scatter-point", p.series !== undefined ? seriesClassForKey(p.series) : "nre-series-none")}
              data-key={p.key}
            >
              <title>{p.title}</title>
              {/* 标签不在紧邻位时补一条 leader line,避免脱离原点看不出对应关系 */}
              {label.leader && <line className="nre-leader" x1={p.px} y1={p.py} x2={label.x} y2={label.y - 4} />}
              <circle className="nre-scatter-hit" cx={p.px} cy={p.py} r={12} />
              <circle className="nre-scatter-dot" cx={p.px} cy={p.py} r={4.5} />
              <text className="nre-scatter-point-label" x={label.x} y={label.y} textAnchor={label.anchor}>
                {p.label}
              </text>
            </g>
          );
          const row = drawableRows[i];
          return pointHref ? (
            <a key={p.key} className="nre-scatter-point-link" href={pointHref(row)}>
              {group}
            </a>
          ) : (
            <g key={p.key}>{group}</g>
          );
        })}
      </svg>

      {/* 系列图例:同键同色(与其它块的稳定散列一致) */}
      {seriesOrder.length > 0 && (
        <figcaption className="nre-scatter-legend">
          {seriesOrder.map((series) => (
            <span key={series} className={cx("nre-legend-key", "nre-key", colorClassForKey(series))}>
              {series}
            </span>
          ))}
        </figcaption>
      )}
      {missingNote}
    </figure>
  );
}
