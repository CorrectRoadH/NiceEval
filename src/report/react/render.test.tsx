// 「不 hydrate 也完整」的验收测试:每个组件过 renderToStaticMarkup,
// 断言纯静态 HTML 里就有全部关键内容——数字、覆盖率角标、缺数据文案、
// 散点的 SVG 与系列名、truncated 行、attemptHref 链接。
// 另外锁两条契约:源码零 hooks;维度键跨组件同色。

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TableData } from "../types.ts";

import {
  CaseList,
  DeltaTable,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  RunOverview,
  Scoreboard,
} from "./index.tsx";
import { colorClassForKey, seriesClassForKey } from "./colors.ts";
import {
  caseListData,
  deltaData,
  matrixData,
  overviewData,
  overviewWithCost,
  passRateColumn,
  scatterData,
  scoreboardData,
  tableData,
  tableDataWithMeta,
} from "./fixtures.ts";

const attemptHref = (ref: { snapshot: string; attempt: string }) => `/attempts/${ref.snapshot}/${ref.attempt}`;

describe("RunOverview", () => {
  const html = renderToStaticMarkup(<RunOverview data={overviewData} />);

  it("KPI 条:快照数、题数、attempts、通过率、耗时", () => {
    expect(html).toContain("nre-overview");
    expect(html).toContain("<dd>12</dd>"); // 题目
    expect(html).toContain("<dd>48</dd>"); // attempts
    // totals.passRate.display 原样渲染(两级聚合 70%),不是从 passed/failed/errored
    // 现场重算的 78%(36/(36+8+2))—— 两个数刻意不同,证明组件没有偷懒重算
    expect(html).toContain("70%");
    expect(html).not.toContain("78%");
    expect(html).toContain("46/48"); // samples < total:覆盖率角标(2 个 skipped attempt 不进桶)
    expect(html).toContain("4m 21s"); // 261000ms
  });

  it("costUSD 全缺 = null:显示缺数据,不编 $0", () => {
    expect(html).toContain("no data");
    expect(html).not.toContain("$0");
    const withCost = renderToStaticMarkup(<RunOverview data={overviewWithCost} />);
    expect(withCost).toContain("$1.23");
  });

  it("数据来源与 warnings 直接渲染在条内", () => {
    expect(html).toContain("2 snapshots");
    expect(html).toContain("compare/bub");
    expect(html).toContain("2026-07-01T10:00:00Z");
    expect(html).toContain("snapshot covers 9 of 12 evals seen in history");
    expect(html).toContain("nre-warnings");
  });
});

describe("MetricTable", () => {
  const html = renderToStaticMarkup(<MetricTable data={tableData} attemptHref={attemptHref} />);

  it("按传入顺序渲染行,不重排(排序在数据侧)", () => {
    // fixture 里 codex(50%)在 bub(87%)前面,输出必须保持
    expect(html.indexOf(">codex<")).toBeGreaterThan(-1);
    expect(html.indexOf(">codex<")).toBeLessThan(html.indexOf(">bub<"));
  });

  it("列头带 label、unit 与 better 方向", () => {
    expect(html).toContain("pass rate");
    expect(html).toContain("(%)");
    expect(html).toContain("code lines");
    expect(html).toContain("↑");
    expect(html).toContain("↓");
  });

  it("数字与覆盖率角标:samples < total 如实标出", () => {
    expect(html).toContain("87%");
    expect(html).toContain("120 lines");
    expect(html).toMatch(/<sup class="nre-coverage"[^>]*>5\/6<\/sup>/);
  });

  it("全 null 渲染缺数据文案,绝不画 0", () => {
    expect(html).toContain("no data");
    expect(html).toContain("nre-cell-missing");
  });

  it("refs + attemptHref 出普通 <a>", () => {
    expect(html).toContain('href="/attempts/exp/run-a/eval/a0"');
  });

  it("渐进增强的 data 属性:所有表头 data-nre-sort、格子 data-sort-value(无 JS 时纯属性,内容完整)", () => {
    expect(html.match(/data-nre-sort/g)).toHaveLength(3); // 维度列 + 2 指标列
    expect(html).toContain('data-sort-value="codex"');
    expect(html).toContain('data-sort-value="0.87"');
    // 缺数据格子的排序值为空串:enhance.js 排序时恒沉底
    expect(html).toContain('data-sort-value=""');
  });
});

describe("MetricTable:meta 榜单 parity 与 filter", () => {
  const html = renderToStaticMarkup(<MetricTable data={tableDataWithMeta} />);

  it("meta 在场补 Model / Agent 列,列序 experiment、model、agent、指标、verdicts", () => {
    expect(html).toContain(">Model</th>");
    expect(html).toContain(">Agent</th>");
    expect(html).toContain(">Verdicts</th>");
    expect(html.indexOf(">Model</th>")).toBeLessThan(html.indexOf(">Agent</th>"));
    expect(html.indexOf(">Agent</th>")).toBeLessThan(html.indexOf("pass rate"));
    expect(html).toContain("gpt-5.4");
  });

  it("verdict 计票列:eval 级折叠口径的 pill,零计数不出 pill", () => {
    expect(html).toContain("nre-verdict-pill");
    expect(html).toContain("1 passed");
    expect(html).toContain("1 failed");
    expect(html).toContain("2 passed");
    expect(html).not.toContain("0 errored");
  });

  it("filter 开:表格前渲染 data-nre-filter 输入框(无 JS 静默无功能),仍无 <script>", () => {
    const filtered = renderToStaticMarkup(<MetricTable data={tableDataWithMeta} filter />);
    expect(filtered).toContain("data-nre-filter");
    expect(filtered).toContain('class="nre-filter"');
    expect(filtered.indexOf("nre-filter")).toBeLessThan(filtered.indexOf("<table"));
    expect(filtered).toContain('placeholder="Filter rows…"');
    expect(filtered).not.toContain("<script");
  });

  it("locale=zh-CN:chrome 文案与 meta 列头走字典;display 不本地化", () => {
    const zh = renderToStaticMarkup(<MetricTable data={tableDataWithMeta} filter locale="zh-CN" />);
    expect(zh).toContain(">模型</th>");
    expect(zh).toContain(">结果</th>");
    expect(zh).toContain("1 通过");
    expect(zh).toContain('placeholder="筛选行…"');
    expect(zh).toContain("50%"); // display 是 format 产物,不本地化
  });
});

describe("MetricTable:expand 展开子行", () => {
  const withSubRows: TableData<"pass-rate"> = {
    dimension: "experiment",
    columns: [passRateColumn],
    rows: [
      {
        key: "compare/bub",
        cells: { "pass-rate": { value: 0.5, display: "50%", samples: 2, total: 2, refs: [] } },
        meta: {
          agent: "bub",
          verdicts: { passed: 1, failed: 1, errored: 0, skipped: 0 },
          subRows: [
            {
              key: "algebra/x",
              cells: { "pass-rate": { value: 1, display: "100%", samples: 1, total: 1, refs: [] } },
              verdict: "passed",
              ref: { snapshot: "compare_bub/snap-1", attempt: "algebra/x/a0" },
              runs: 1,
              passedRuns: 1,
            },
            {
              key: "algebra/y",
              cells: { "pass-rate": { value: 0, display: "0%", samples: 1, total: 1, refs: [] } },
              verdict: "failed",
              reason: "expected 4, got 3",
              ref: { snapshot: "compare_bub/snap-1", attempt: "algebra/y/a0" },
              runs: 1,
              passedRuns: 0,
            },
          ],
        },
      },
    ],
  };

  it("展开明细渲染成原生 <details>,零 JS 也能点开;子表复用同一套 columns", () => {
    const html = renderToStaticMarkup(<MetricTable data={withSubRows} attemptHref={attemptHref} />);
    expect(html).toContain("nre-subrows-row");
    expect(html).toContain("<details");
    expect(html).toContain("nre-subtable");
    expect(html).toContain("algebra/x");
    expect(html).toContain("algebra/y");
    expect(html).toContain("expected 4, got 3");
    expect(html).toContain("nre-verdict-passed");
    expect(html).toContain("nre-verdict-failed");
    // 子行的深链走同一个 attemptHref
    expect(html).toContain('href="/attempts/compare_bub/snap-1/algebra/y/a0"');
    expect(html).not.toContain("<script");
  });

  it("没有 subRows 的行不产出展开明细(旧调用点行为不变)", () => {
    const html = renderToStaticMarkup(<MetricTable data={tableDataWithMeta} />);
    expect(html).not.toContain("nre-subrows-row");
  });
});

describe("MetricMatrix", () => {
  const html = renderToStaticMarkup(<MetricMatrix data={matrixData} attemptHref={attemptHref} />);

  it("caption 标出指标与行列维度", () => {
    expect(html).toContain("pass rate");
    expect(html).toContain("eval × agent");
  });

  it("稀疏格子:没有样本的格子空着(恰好一个)", () => {
    expect(html.match(/nre-td-empty/g)).toHaveLength(1);
  });

  it("格子数字与 refs 下钻链接", () => {
    expect(html).toContain("100%");
    expect(html).toContain("0%");
    expect(html).toContain('href="/attempts/exp/run-b/algebra/quadratic/a3"');
    expect(html).toContain('href="/attempts/exp/run-b/algebra/quadratic/a7"');
  });

  it("列头(维度键)带稳定散列配色 class", () => {
    expect(html).toContain(colorClassForKey("bub"));
    expect(html).toContain(colorClassForKey("codex"));
  });
});

describe("Scoreboard", () => {
  const html = renderToStaticMarkup(<Scoreboard data={scoreboardData} />);

  it("总分 + 满分口径", () => {
    expect(html).toContain("78.5");
    expect(html).toContain("52");
    expect(html).toContain("/ 100");
  });

  it("分科小计 earned/possible", () => {
    expect(html).toContain("14/16");
    expect(html).toContain("3/4");
  });

  it("missing 注脚:没跑按 0 计的题数如实展示", () => {
    expect(html).toContain("1 eval missing, scored 0");
    expect(html).toContain("2 evals missing, scored 0");
  });

  it("实际生效的权重表可审计", () => {
    expect(html).toContain("algebra/ ×2");
    expect(html).toContain("others ×1");
  });
});

describe("MetricScatter", () => {
  const html = renderToStaticMarkup(<MetricScatter data={scatterData} pointHref={(row) => `/exp/${row.key}`} />);

  // data-key 在点的 <g> 上,坐标在其内第一个 circle 上(非贪婪跨标签匹配)
  const cxOf = (key: string): number => {
    const m = html.match(new RegExp(`data-key="${key}"[\\s\\S]*?\\bcx="([\\d.]+)"`));
    expect(m, `circle for ${key}`).toBeTruthy();
    return Number(m![1]);
  };
  const cyOf = (key: string): number => {
    const m = html.match(new RegExp(`data-key="${key}"[\\s\\S]*?\\bcy="([\\d.]+)"`));
    expect(m, `circle for ${key}`).toBeTruthy();
    return Number(m![1]);
  };

  it("内联 SVG + 轴标签", () => {
    expect(html).toContain("<svg");
    expect(html).toContain("cost($)");
    expect(html).toContain("pass rate(%)");
  });

  it("better:lower 的 x 轴反向:便宜($5)在贵($10)右边,好的角落恒在右上", () => {
    expect(cxOf("compare/bub-low")).toBeGreaterThan(cxOf("compare/bub-high"));
    // y 轴 better:higher:通过率高(90%)在低(50%)上方(SVG y 向下增长)
    expect(cyOf("compare/bub-high")).toBeLessThan(cyOf("compare/bub-low"));
  });

  it("同系列点连线,系列色走类名(nre-series-cN,CSS 上色跟随深浅主题),图例列系列名", () => {
    expect(html).toContain("<polyline");
    expect(html).toContain(`nre-scatter-line ${seriesClassForKey("bub")}`);
    // 渲染面零内联 hex:深色主题下由 CSS 变量切换
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
    // 图例:codex 只有 1 个可画点、不出线,但系列名仍在图例里
    expect(html).toContain(">bub</span>");
    expect(html).toContain(">codex</span>");
  });

  it("niceTicks 网格与每点直接标签(id 末段)", () => {
    expect(html).toContain("nre-scatter-grid");
    expect(html.match(/nre-scatter-tick/g)!.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain(">bub-low</text>");
    expect(html).toContain(">codex-mid</text>");
  });

  it("null 点不画,底部注脚如实报数", () => {
    expect(html).not.toContain('data-key="compare/codex-broken"');
    expect(html).toContain("1 point missing data");
  });

  it("hover 退化为 <title>:display 与 samples/total", () => {
    expect(html).toContain("<title>");
    expect(html).toContain("50%(6/6)");
  });

  it("pointHref:点包普通 <a>", () => {
    expect(html).toContain('href="/exp/compare/bub-low"');
  });

  it("全部点都缺数据时不画空坐标系:显式说明缺哪两个指标", () => {
    const empty = renderToStaticMarkup(
      <MetricScatter
        data={{
          ...scatterData,
          rows: scatterData.rows.map((r) => ({ ...r, x: { ...r.x, value: null } })),
        }}
      />,
    );
    expect(empty).not.toContain("<svg");
    expect(empty).toContain("No data to plot"); // 0 可画点:命名 x/y 指标,不画空图
    expect(empty).toContain("4 points missing data");
  });

  it("恰好 1 个可画点:比较至少要两个实验,不画孤点图", () => {
    const single = renderToStaticMarkup(
      <MetricScatter
        data={{
          ...scatterData,
          // 只留第一个点可画,其余 x 置空
          rows: scatterData.rows.map((r, i) => (i === 0 ? r : { ...r, x: { ...r.x, value: null } })),
        }}
      />,
    );
    expect(single).not.toContain("<svg");
    expect(single).toContain("At least 2 experiments needed to compare");
  });
});

describe("DeltaTable", () => {
  const html = renderToStaticMarkup(<DeltaTable data={deltaData} />);

  it("每格 A/B/Δ 三值", () => {
    expect(html).toContain("50%");
    expect(html).toContain("62%");
    expect(html).toContain("+12pp");
    expect(html).toContain(">A</span>");
    expect(html).toContain(">B</span>");
    expect(html).toContain(">Δ</span>");
  });

  it("涨跌好坏按 better 配色:通过率涨=好,成本涨=坏,0=平", () => {
    expect(html).toContain("nre-delta-good");
    expect(html).toContain("nre-delta-bad");
    expect(html).toContain("nre-delta-flat");
  });

  it("任一侧缺数据:Δ 显示为缺,不硬算", () => {
    expect(html).toContain("nre-delta-missing");
    expect(html).toContain("no data");
  });

  it("每行标出 A → B 的 experimentId", () => {
    expect(html).toContain("compare/bub → compare/bub--agents-md");
  });
});

describe("CaseList", () => {
  const html = renderToStaticMarkup(<CaseList data={caseListData} attemptHref={attemptHref} />);

  it("逐条失败断言:name、score、detail、evidence", () => {
    expect(html).toContain("roots-correct");
    expect(html).toContain("score 0");
    expect(html).toContain("expected x=2, got x=3");
    expect(html).toContain("judge: sign flipped when substituting into the quadratic formula");
  });

  it("errored 的 error 摘要", () => {
    expect(html).toContain("TypeError: cannot read properties of undefined");
  });

  it("truncated 如实报「还有 n 条没列」", () => {
    expect(html).toContain("and 2 more not shown");
  });

  it("每条案例带 attemptHref 下钻链接", () => {
    expect(html).toContain('href="/attempts/exp/run-a/algebra/quadratic/a4"');
    expect(html).toContain('href="/attempts/exp/run-c/geometry/angles/a1"');
  });

  it("长文本收进 <details>,零 JS 可展开", () => {
    expect(html).toContain("<details");
    expect(html).toContain("<summary>");
  });
});

describe("跨组件契约", () => {
  it("同一维度键在所有块里同色(稳定散列,与渲染顺序无关)", () => {
    const cls = colorClassForKey("bub");
    const table = renderToStaticMarkup(<MetricTable data={tableData} />);
    const matrix = renderToStaticMarkup(<MetricMatrix data={matrixData} />);
    const board = renderToStaticMarkup(<Scoreboard data={scoreboardData} />);
    const delta = renderToStaticMarkup(<DeltaTable data={deltaData} />);
    const cases = renderToStaticMarkup(<CaseList data={caseListData} />);
    for (const html of [table, matrix, board, delta, cases]) {
      expect(html).toContain(cls);
    }
    const scatter = renderToStaticMarkup(<MetricScatter data={scatterData} />);
    expect(scatter).toContain(seriesClassForKey("bub"));
  });

  it("静态输出不含 <script>:交互只靠 <a>/<details>/CSS", () => {
    const all = [
      renderToStaticMarkup(<RunOverview data={overviewData} />),
      renderToStaticMarkup(<MetricTable data={tableData} attemptHref={attemptHref} />),
      renderToStaticMarkup(<MetricMatrix data={matrixData} attemptHref={attemptHref} />),
      renderToStaticMarkup(<Scoreboard data={scoreboardData} />),
      renderToStaticMarkup(<MetricScatter data={scatterData} />),
      renderToStaticMarkup(<DeltaTable data={deltaData} />),
      renderToStaticMarkup(<CaseList data={caseListData} />),
    ].join("");
    expect(all).not.toContain("<script");
  });

  it("组件源码零 hooks(本实验的「不 hydrate 也完整」用最笨的方式保证)", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(dir)
      .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))
      .map((f) => readFileSync(join(dir, f), "utf8"));
    expect(sources.length).toBeGreaterThanOrEqual(12);
    for (const src of sources) {
      expect(src).not.toMatch(/\buse[A-Z][A-Za-z]*\s*\(/);
    }
  });
});
