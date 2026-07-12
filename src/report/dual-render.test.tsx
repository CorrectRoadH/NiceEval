// 双面验收:每个官方组件对同一份数据,web 面(renderToStaticMarkup)与 text 面
// 给出一致判读 —— 排序方向随 better、samples < total 角标、缺数据 — 不补 0、
// 截断如实报剩余;text 面形态以内联快照锁定(照 report-components.mdx 的示例形态)。
// 另验收:排版原语的分栏与降级、渲染前树校验、defineComponent 自定义组件、
// defineReport + renderReportToText / renderReportToStaticHtml 两个宿主入口。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EvalResult } from "../types.ts";
import type { Results, Selection, Snapshot } from "../results/index.ts";
import type { GroupSummaryData } from "./types.ts";
import { evalLevelStats } from "../shared/verdict.ts";
import {
  CaseList,
  Col,
  DefaultReport,
  DeltaTable,
  GroupSummary,
  MetricBars,
  MetricLine,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  Row,
  RunOverview,
  Scoreboard,
  Section,
  Style,
  Text,
  defaultReport,
  defineComponent,
  defineReport,
  isReportDefinition,
  renderReportToText,
} from "./index.ts";
import { renderReportToStaticHtml } from "./web.ts";
import { createTextContext, renderNodeToText, validateReportTree } from "./tree.ts";
import {
  caseListData,
  deltaData,
  groupSummaryData,
  lineData,
  matrixData,
  overviewData,
  scatterData,
  scoreboardData,
  tableData,
} from "./react/fixtures.ts";

const ctx = createTextContext({ width: 80 });
const text = (node: Parameters<typeof renderNodeToText>[0]) => renderNodeToText(node, ctx);

// ───────────────────────── 每组件双面一致 ─────────────────────────

describe("RunOverview 双面", () => {
  const html = renderToStaticMarkup(<RunOverview data={overviewData} />);
  const term = text(<RunOverview data={overviewData} />);

  it("text 面形态:头行(含通过率)+ 判定行 + 警告行", () => {
    expect(term).toMatchInlineSnapshot(`
      "2 experiments · 12 evals · 48 attempts · Pass rate 70% 46/48 · composed from 2 runs · latest 2026-07-01T11:30:00Z
      passed 36 · failed 8 · errored 2 · skipped 2 · no data · 4m 21s
      ! snapshot covers 9 of 12 evals seen in history; re-run \`niceeval exp compare/bub\` for a full snapshot"
    `);
  });

  it("两面同口径:通过率显示同一个 MetricCell.display(70%,不是 36/46 现算的 78%);成本全缺都是 no data 不编 $0;警告都在", () => {
    for (const face of [html, term]) {
      expect(face).toContain("70%");
      expect(face).not.toContain("78%");
      expect(face).toContain("46/48"); // samples < total:两级聚合的覆盖率角标,两面一致
      expect(face).toContain("no data");
      expect(face).not.toContain("$0");
      expect(face).toContain("snapshot covers 9 of 12 evals");
    }
  });
});

// fixtures.overviewData 是手工摆好的终值,只验证渲染面「原样显示 MetricCell,不重算」;
// 下面这组用真实 Selection 走一遍 RunOverview.data(= compute.ts 的 overviewData()),
// 专门验证 totals.passRate 本身的计算口径 —— 三种通过率公式在这个 fixture 上各不相同:
//   两级聚合(唯一官方口径,docs/reports.md「通过率」):eval a 题内 2/3 通过、eval b 题内 1,
//     跨题均值 (2/3 + 1) / 2 = 5/6 ≈ 83.3%
//   attempt 原始占比(旧 bug 公式,曾经的 RunOverview 现场重算):3 passed / (3 passed + 1 failed) = 75%
//   eval 折叠投票(evalLevelStats,GroupSummary/MetricTable meta 的口径):a、b 都折成 passed → 2/2 = 100%
// 三个数互不相同,任何一处偷懒复用另一个公式都会在这里露馅。
describe("RunOverview.data · passRate 两级聚合口径", () => {
  function fakeVaryingAttemptsContext(): { selection: Selection; attempts: { evalId: string; result: { verdict: EvalResult["verdict"] } }[] } {
    const dir = "/results/compare_bub/snap-1";
    const base = {
      experimentId: "compare/bub",
      startedAt: "2026-07-01T10:00:00Z",
      completedAt: "2026-07-01T10:05:00Z",
      agent: "bub",
      schemaVersion: 1,
      dir,
    };
    const mk = (evalId: string, verdict: "passed" | "failed" | "skipped", attemptIndex: number, minute: number) => ({
      evalId,
      experimentId: "compare/bub",
      result: {
        id: evalId,
        agent: "bub",
        verdict,
        attempt: attemptIndex,
        startedAt: `2026-07-01T10:0${minute}:00Z`,
        durationMs: 1000,
        assertions: [],
      },
      ref: { snapshot: "compare_bub/snap-1", attempt: `${evalId}/a${attemptIndex}` },
      snapshot: base,
      events: async () => null,
      trace: async () => null,
      o11y: async () => null,
      diff: async () => null,
      sources: async () => null,
    });
    const attempts = [
      // eval a:3 attempts,2 通过 1 失败 → 题内 partial credit 2/3
      mk("algebra/a", "passed", 0, 0),
      mk("algebra/a", "failed", 1, 1),
      mk("algebra/a", "passed", 2, 2),
      // eval b:1 attempt 通过 → 题内 1
      mk("algebra/b", "passed", 0, 3),
      // eval c:1 attempt 跳过 —— 两级聚合与 eval 折叠计票都要把它排除在分母外
      mk("algebra/c", "skipped", 0, 4),
    ];
    const evalIds = [...new Set(attempts.map((a) => a.evalId))];
    const snapshot: Snapshot = {
      ...base,
      evals: evalIds.map((id) => ({ id, attempts: attempts.filter((a) => a.evalId === id) })),
      attempts,
    } as unknown as Snapshot;
    const selection: Selection = { snapshots: [snapshot], warnings: [], filter: () => selection };
    return { selection, attempts };
  }

  it("totals.passRate = 两级聚合 83.3%,既不等于 attempt 原始占比 75%,也不等于 eval 折叠投票 100%", async () => {
    const { selection, attempts } = fakeVaryingAttemptsContext();
    const data = await RunOverview.data(selection);

    expect(data.totals.passRate.value).toBeCloseTo(5 / 6, 10);
    expect(data.totals.passRate.display).toBe("83.3%");
    expect(data.totals.passRate.samples).toBe(4); // 5 attempts - 1 skipped(不进桶)
    expect(data.totals.passRate.total).toBe(5);

    // attempt 原始占比(旧 bug 公式):必须与两级聚合不同,证明没有从 passed/failed/errored 现算
    const attemptFraction = data.totals.passed / (data.totals.passed + data.totals.failed + data.totals.errored);
    expect(attemptFraction).toBeCloseTo(0.75, 10);
    expect(attemptFraction).not.toBeCloseTo(data.totals.passRate.value as number, 3);

    // eval 折叠投票(evalLevelStats,GroupSummary 的口径):也必须与两级聚合不同
    const stats = evalLevelStats(
      attempts.map((a) => ({ verdict: a.result.verdict, key: a.evalId })),
      (r) => r.key,
    );
    expect(stats.passRate).toBeCloseTo(1, 10);
    expect(stats.passRate).not.toBeCloseTo(data.totals.passRate.value as number, 3);
  });

  it("web 面与 text 面显示同一个 passRate.display,覆盖率角标(4/5)两面一致", async () => {
    const { selection } = fakeVaryingAttemptsContext();
    const data = await RunOverview.data(selection);
    const html = renderToStaticMarkup(<RunOverview data={data} />);
    const term = text(<RunOverview data={data} />);
    for (const face of [html, term]) {
      expect(face).toContain(data.totals.passRate.display);
      expect(face).toContain("4/5");
    }
  });
});

// ───────────────────────── GroupSummary ─────────────────────────

describe("GroupSummary 双面", () => {
  const html = renderToStaticMarkup(<GroupSummary data={groupSummaryData} />);
  const term = text(<GroupSummary data={groupSummaryData} />);

  it("text 面形态:一行头(通过率 + experiment/eval 数 + failed/errored + 总成本)+ 最后运行时间", () => {
    expect(term).toMatchInlineSnapshot(`
      "Pass rate 60% 5/6 · 2 experiments · 6 evals · failed 1 · errored 1 · $1.50
      latest 2026-07-01T11:30:00Z"
    `);
  });

  it("两面同口径:通过率显示同一个 MetricCell.display(60%,不是现场重算);总成本、最后运行时间两面一致", () => {
    for (const face of [html, term]) {
      expect(face).toContain("60%");
      expect(face).toContain("$1.50");
      expect(face).toContain("2026-07-01T11:30:00Z");
    }
    // 覆盖率角标:samples(5) < total(6) —— 1 道 eval 是 skipped,没进分母
    expect(html).toContain("5/6");
    expect(term).toContain("5/6");
  });

  it("缺成本:两面都显示无数据文案,不编 $0", () => {
    const missingCost: GroupSummaryData = { ...groupSummaryData, totalCostUSD: null };
    const h = renderToStaticMarkup(<GroupSummary data={missingCost} />);
    const t = text(<GroupSummary data={missingCost} />);
    for (const face of [h, t]) {
      expect(face).toContain("no data");
      expect(face).not.toContain("$0");
    }
  });

  it("零失败:web 面整个 errored 片段不渲染,text 面也没有 errored 分段;failed 仍如实显示 0(不是省略整个字段)", () => {
    const allPassed: GroupSummaryData = {
      ...groupSummaryData,
      verdicts: { passed: 6, failed: 0, errored: 0, skipped: 0 },
      passRate: { value: 1, display: "100%", samples: 6, total: 6, refs: [] },
    };
    const h = renderToStaticMarkup(<GroupSummary data={allPassed} />);
    const t = text(<GroupSummary data={allPassed} />);
    expect(h).not.toContain("nre-verdict-errored");
    expect(h).not.toContain(">errored<");
    expect(t).not.toContain("errored");
    // failed 计数依旧渲染,哪怕是 0 —— 数据字段本身从不省略,只是 errored 的展示片段在 0 时省略
    expect(h).toContain(">failed<");
    expect(t).toContain("failed 0");
  });

  it("存在错误:两面都显示 errored 计数(与 groupSummaryData 基础 fixture 的 errored:1 一致)", () => {
    expect(html).toContain("nre-verdict-errored");
    expect(html).toContain(">errored<");
    expect(term).toContain("errored 1");
  });

  it("zh-CN locale:web 面走中文字典(通过率/失败/错误/总成本/实验数),text 面同理;display 数字不本地化", () => {
    const zhHtml = renderToStaticMarkup(<GroupSummary data={groupSummaryData} locale="zh-CN" />);
    expect(zhHtml).toContain("通过率");
    expect(zhHtml).toContain("失败");
    expect(zhHtml).toContain("错误");
    expect(zhHtml).toContain("总成本");
    expect(zhHtml).toContain("实验数");
    expect(zhHtml).toContain("60%"); // display 本身不随 locale 变

    const zhCtx = createTextContext({ width: 80, locale: "zh-CN" });
    const zhTerm = renderNodeToText(<GroupSummary data={groupSummaryData} />, zhCtx);
    expect(zhTerm).toContain("通过率");
    expect(zhTerm).toContain("失败 1");
    expect(zhTerm).toContain("错误 1");
    expect(zhTerm).toContain("60%");
  });
});

describe("MetricTable 双面", () => {
  const html = renderToStaticMarkup(<MetricTable data={tableData} />);
  const term = text(<MetricTable data={tableData} />);

  it("text 面形态:对齐列 + 覆盖率角标 + 缺数据 —", () => {
    expect(term).toMatchInlineSnapshot(`
      "agent   pass rate   code lines
      codex   50%         —
      bub     87%         120 lines 5/6"
    `);
  });

  it("两面同口径:行序一致(预排即终排)、角标一致、缺数据不补 0", () => {
    // 行序:codex 在 bub 前(数据侧顺序,两面都不重排)
    expect(html.indexOf(">codex<")).toBeLessThan(html.indexOf(">bub<"));
    expect(term.indexOf("codex")).toBeLessThan(term.indexOf("bub"));
    // 覆盖率角标 5/6 两面都在
    expect(html).toContain("5/6");
    expect(term).toContain("5/6");
    // 全 null 格子:web 是 no data 文案,text 是 —,都绝不画 0
    expect(html).toContain("no data");
    expect(term).toContain("—");
  });
});

describe("MetricMatrix 双面", () => {
  const html = renderToStaticMarkup(<MetricMatrix data={matrixData} />);
  const term = text(<MetricMatrix data={matrixData} />);

  it("text 面形态:稀疏格子 — + 下钻命令指向最值得看的一行", () => {
    expect(term).toMatchInlineSnapshot(`
      "eval                bub    codex
      algebra/quadratic   100%   0%
      geometry/angles     50%    —

      next: niceeval show geometry/angles"
    `);
  });

  it("两面同口径:数字一致,稀疏格子不编数", () => {
    for (const value of ["100%", "0%", "50%"]) {
      expect(html).toContain(value);
      expect(term).toContain(value);
    }
    expect(html.match(/nre-td-empty/g)).toHaveLength(1); // web 空格子
  });
});

describe("MetricBars 双面", () => {
  const html = renderToStaticMarkup(<MetricBars data={matrixData} />);
  const term = text(<MetricBars data={matrixData} />);

  it("text 面形态:一组条 = 一个 row 键,条长即刻度,缺数据 —", () => {
    expect(term).toMatchInlineSnapshot(`
      "algebra/quadratic
        bub     ████████████████████  100%
        codex   ░░░░░░░░░░░░░░░░░░░░  0%
      geometry/angles
        bub     ██████████░░░░░░░░░░  50%
        codex   —"
    `);
  });

  it("两面同口径:组内按值排序(better higher 降序),缺数据不出柱", () => {
    expect(html).toContain("100%");
    expect(html).toContain("50%");
    // web 面:codex 在 geometry/angles 组没有柱(缺数据),柱数 = 3
    expect(html.match(/class="nre-bar /g)).toHaveLength(3);
    // text 面:codex 行是 —
    expect(term).toContain("codex   —");
  });
});

describe("Scoreboard 双面", () => {
  const html = renderToStaticMarkup(<Scoreboard data={scoreboardData} />);
  const term = text(<Scoreboard data={scoreboardData} />);

  it("text 面形态:总分/满分 + 分科 + missing 注脚 + 权重表", () => {
    expect(term).toMatchInlineSnapshot(`
      "agent   total      algebra             geometry
      bub     78.5/100   14/16 (1 missing)   3/4
      codex   52/100     9/16                1.4/4 (2 missing)
      weights: algebra/ ×2 · others ×1"
    `);
  });

  it("两面同口径:missing 与权重都如实", () => {
    expect(html).toContain("1 eval missing, scored 0");
    expect(term).toContain("(1 missing)");
    expect(html).toContain("algebra/ ×2");
    expect(term).toContain("algebra/ ×2");
  });
});

describe("MetricScatter 双面", () => {
  const html = renderToStaticMarkup(<MetricScatter data={scatterData} />);
  const term = text(<MetricScatter data={scatterData} />);

  it("text 面形态:字符坐标图 + 图例 + 缺数据注脚", () => {
    expect(term).toMatchInlineSnapshot(`
      "    pass rate ↑
       90%│B····
          │     ·········
          │              ··········
          │                        ·········
          │                                 ·········
          │                                          ·········
          │                                            C      ··········
          │                                                             ·········
       50%│                                                                      ····A
          └───────────────────────────────────────────────────────────────────────────→ cost (axis reversed: right = better)
           $10.00                                                                $5.00

      better → upper right
      A compare/bub-low   B compare/bub-high   C compare/codex-mid
      1 point missing data"
    `);
  });

  it("两面同口径:x 轴反向(lower 好的一端在右)、缺数据点都不画、注脚同数", () => {
    // web:$5(便宜)在 $10 右边(cx 更大)——render.test.tsx 已细测,这里只对注脚
    expect(html).toContain("1 point missing data");
    expect(term).toContain("1 point missing data");
    expect(html).not.toContain('data-key="compare/codex-broken"'); // 注脚 title 如实列缺数据的点,但不画
    // text 图例里也没有缺数据的点
    expect(term).not.toContain("codex-broken");
  });

  it("点太密时降级坐标表,不硬挤", () => {
    const narrow = renderNodeToText(<MetricScatter data={scatterData} />, createTextContext({ width: 40 }));
    expect(narrow).toContain("experiment");
    expect(narrow).toContain("$5.00");
    expect(narrow).not.toContain("└");
  });
});

describe("MetricLine 双面", () => {
  const html = renderToStaticMarkup(<MetricLine data={lineData} />);
  const term = text(<MetricLine data={lineData} />);

  it("text 面形态:同系列一个字母、沿 x 排布,y 轴刻度,图例 + 缺数据注脚", () => {
    expect(term).toMatchInlineSnapshot(`
      "    pass rate ↑
       80%│B··················
          │                   ·····································
          │                                                        ··················B
          │
          │
          │
          │A··················
          │                   ·····································
       30%│                                                        ··················A
          └───────────────────────────────────────────────────────────────────────────→ Simulated latency
           100ms                                                                 300ms

      A 1 agents   B 16 agents
      1 point missing data"
    `);
  });

  it("两面同口径:未声明 flag 的点两面都不画、注脚同数", () => {
    expect(html).toContain("1 point missing data");
    expect(term).toContain("1 point missing data");
    expect(html).not.toContain('data-key="ultra/legacy"'); // 注脚 title 如实列缺数据的点,但不画
  });
});

describe("DeltaTable 双面", () => {
  const html = renderToStaticMarkup(<DeltaTable data={deltaData} />);
  const term = text(<DeltaTable data={deltaData} />);

  it("text 面形态:A → B + Δ,单侧缺数据是 —,Δ=0 是 ±0", () => {
    expect(term).toMatchInlineSnapshot(`
      "pair    pass rate           cost
      bub     50% → 62%   +12pp   $0.20 → $0.35   +$0.15
      codex   40% → 40%   ±0      — → $0.30   —"
    `);
  });

  it("两面同口径:Δ 文案一致、缺数据都不硬算", () => {
    for (const piece of ["+12pp", "+$0.15", "±0"]) {
      expect(html).toContain(piece);
      expect(term).toContain(piece);
    }
    expect(html).toContain("nre-delta-missing");
    expect(term).toContain("— → $0.30");
  });
});

describe("CaseList 双面", () => {
  const html = renderToStaticMarkup(<CaseList data={caseListData} />);
  const term = text(<CaseList data={caseListData} />);

  it("text 面形态:逐条案例 + 下钻命令 + 截断报剩余", () => {
    expect(term).toMatchInlineSnapshot(`
      "✗ algebra/quadratic · compare/bub · failed · 32.0s · $0.12
          roots-correct — expected x=2, got x=3
            judge: sign flipped when substituting into the quadratic formula
          → niceeval show algebra/quadratic
      ✗ geometry/angles · compare/codex · errored · 4.5s
          TypeError: cannot read properties of undefined (reading 'foo')
          → niceeval show geometry/angles

      (2 more not shown)"
    `);
  });

  it("两面同口径:失败断言、error、truncated 数一致", () => {
    for (const piece of ["roots-correct", "expected x=2, got x=3", "TypeError", "2 more not shown"]) {
      expect(html).toContain(piece);
      expect(term).toContain(piece);
    }
  });
});

// ───────────────────────── 排版原语 ─────────────────────────

describe("排版原语", () => {
  it("Col 纵向堆叠;Section 标题 + 缩进;Text 折行;Style text 面为空", () => {
    const node = (
      <Col>
        <Section title="考试成绩单">
          <Text>algebra 权重 ×2,满分 100。</Text>
        </Section>
        <Style>{`.passbars i { background: #4a7; }`}</Style>
      </Col>
    );
    expect(text(node)).toMatchInlineSnapshot(`
      "考试成绩单
        algebra 权重 ×2,满分 100。"
    `);
    const html = renderToStaticMarkup(node);
    expect(html).toContain("<h2 class=\"nre-section-title\">考试成绩单</h2>");
    expect(html).toContain("<style>.passbars i { background: #4a7; }</style>");
  });

  it("Row:宽度够时字符分栏,│ 分隔,各栏折到自己的宽度", () => {
    const node = (
      <Row>
        <Text>left column body</Text>
        <Text>right column body</Text>
      </Row>
    );
    const wide = renderNodeToText(node, createTextContext({ width: 60 }));
    expect(wide).toContain("│");
    expect(wide.split("\n")[0]).toContain("left column body");
    expect(wide.split("\n")[0]).toContain("right column body");
  });

  it("Row:宽度不足降级纵向,不硬挤", () => {
    const node = (
      <Row>
        <Text>left column body</Text>
        <Text>right column body</Text>
      </Row>
    );
    const narrow = renderNodeToText(node, createTextContext({ width: 30 }));
    expect(narrow).not.toContain("│");
    expect(narrow).toContain("left column body\n\nright column body");
  });
});

// ───────────────────────── 树校验与自定义组件 ─────────────────────────

describe("渲染前树校验", () => {
  it("字符串 intrinsic(<div>)报错,错误指名组件路径", () => {
    const bad = (
      <Col>
        <Section title="x">
          <div>raw</div>
        </Section>
      </Col>
    );
    expect(() => validateReportTree(bad)).toThrow(
      /Raw HTML <div> has no terminal face; use <Text>, layout primitives, or a defineComponent component\. \(in <Col> > <Section>\)/,
    );
  });

  it("普通函数组件(组合页面片段)被调用展开继续校验", () => {
    const Fragmented = () => (
      <Col>
        <Text>ok</Text>
      </Col>
    );
    expect(() => validateReportTree(<Fragmented />)).not.toThrow();
    const BadInside = () => <span>nope</span>;
    expect(() => validateReportTree(<BadInside />)).toThrow(/Raw HTML <span>/);
  });
});

describe("defineComponent", () => {
  it("faces 两键必填,少一个面在运行时也拦住(编译期本就不过)", () => {
    // @ts-expect-error 缺 text 面编译不过;运行时同样报错
    expect(() => defineComponent({ web: () => null })).toThrow(/requires both faces/);
  });

  it("自定义双面组件:同一份数据两面判读一致,text 面拿到宽度", () => {
    interface BarRow {
      key: string;
      ratio: number | null;
      display: string;
    }
    const PassBars = defineComponent<{ rows: BarRow[] }>({
      web({ rows }) {
        return (
          <ul className="passbars">
            {rows.map((r) => (
              <li key={r.key}>
                <span>{r.key}</span>
                <b>{r.ratio === null ? "—" : r.display}</b>
              </li>
            ))}
          </ul>
        );
      },
      text({ rows }, { width }) {
        const bar = (n: number) => "█".repeat(Math.round(n * 10)).padEnd(10, "░");
        expect(width).toBe(80);
        return rows
          .map((r) => `${r.key.padEnd(8)} ${r.ratio === null ? "—".padEnd(10) : bar(r.ratio)} ${r.display}`)
          .join("\n");
      },
    });
    const rows: BarRow[] = [
      { key: "bub", ratio: 0.87, display: "87%" },
      { key: "claude", ratio: null, display: "—" },
    ];
    const term = text(<PassBars rows={rows} />);
    expect(term).toMatchInlineSnapshot(`
      "bub      █████████░ 87%
      claude   —          —"
    `);
    const html = renderToStaticMarkup(<PassBars rows={rows} />);
    expect(html).toContain("87%");
    expect(html).toContain("—"); // 缺数据两面都是 —,不补 0
  });
});

// ───────────────────────── defineReport 与两个宿主入口 ─────────────────────────

function fakeContext(): { selection: Selection; results: Results } {
  const snapshot: Snapshot = (() => {
    const dir = "/results/compare_bub/snap-1";
    const base = {
      experimentId: "compare/bub",
      startedAt: "2026-07-01T10:00:00Z",
      completedAt: "2026-07-01T10:05:00Z",
      agent: "bub",
      schemaVersion: 1,
      dir,
    };
    const mk = (id: string, verdict: "passed" | "failed", index: number) => ({
      evalId: id,
      experimentId: "compare/bub",
      result: {
        id,
        agent: "bub",
        verdict,
        attempt: 0,
        startedAt: `2026-07-01T10:0${index}:00Z`,
        durationMs: 1000,
        assertions: [],
      },
      ref: { snapshot: "compare_bub/snap-1", attempt: `${id}/a0` },
      snapshot: base,
      events: async () => null,
      trace: async () => null,
      o11y: async () => null,
      diff: async () => null,
      sources: async () => null,
    });
    const attempts = [mk("algebra/x", "passed", 0), mk("algebra/y", "failed", 1)];
    return {
      ...base,
      evals: attempts.map((a) => ({ id: a.evalId, attempts: [a] })),
      attempts,
    } as unknown as Snapshot;
  })();
  const selection: Selection = {
    snapshots: [snapshot],
    warnings: [],
    filter: () => selection,
  };
  const results = {
    experiments: [{ id: "compare/bub", snapshots: [snapshot], latest: snapshot, evalIds: ["algebra/x", "algebra/y"] }],
    skipped: [],
    latest: () => selection,
  } as Results;
  return { selection, results };
}

/**
 * 同 fakeContext,但 "algebra/y" 这条失败 eval 的 result 可注入 error/skipReason/assertions ——
 * 专门驱动 <DefaultReport /> 的 failing board(official-report.tsx 的 buildBoard)走一遍真实
 * reasonFor 优先级(与 MetricTable expand 子行、CaseList 同一套材料)。
 */
function fakeContextWithReason(resultExtra: Partial<EvalResult>): { selection: Selection; results: Results } {
  const snapshot: Snapshot = (() => {
    const dir = "/results/compare_bub/snap-1";
    const base = {
      experimentId: "compare/bub",
      startedAt: "2026-07-01T10:00:00Z",
      completedAt: "2026-07-01T10:05:00Z",
      agent: "bub",
      schemaVersion: 1,
      dir,
    };
    const mk = (id: string, verdict: "passed" | "failed", index: number, extra: Partial<EvalResult> = {}) => ({
      evalId: id,
      experimentId: "compare/bub",
      result: {
        id,
        agent: "bub",
        verdict,
        attempt: 0,
        startedAt: `2026-07-01T10:0${index}:00Z`,
        durationMs: 1000,
        assertions: [],
        ...extra,
      },
      ref: { snapshot: "compare_bub/snap-1", attempt: `${id}/a0` },
      snapshot: base,
      events: async () => null,
      trace: async () => null,
      o11y: async () => null,
      diff: async () => null,
      sources: async () => null,
    });
    const attempts = [mk("algebra/x", "passed", 0), mk("algebra/y", "failed", 1, resultExtra)];
    return {
      ...base,
      evals: attempts.map((a) => ({ id: a.evalId, attempts: [a] })),
      attempts,
    } as unknown as Snapshot;
  })();
  const selection: Selection = {
    snapshots: [snapshot],
    warnings: [],
    filter: () => selection,
  };
  const results = {
    experiments: [{ id: "compare/bub", snapshots: [snapshot], latest: snapshot, evalIds: ["algebra/x", "algebra/y"] }],
    skipped: [],
    latest: () => selection,
  } as Results;
  return { selection, results };
}

/**
 * 三份快照:两个不同组("compare"、"other")各一个 experiment,外加一个无组实验("solo")—
 * 混合用例,专门驱动 defaultReport 遍历 `groupKeysOf` 产出 3 个不同组键(2 个具名组 +
 * 1 个 `undefined`)。`filter` 落实真实语义(不像 fakeContext 那样恒等返回自己),
 * 因为 defaultReport 会用 `selection.filter((s) => groupOf(s) === key)` 按组键收窄。
 */
function fakeMultiGroupContext(): { selection: Selection; results: Results } {
  const mkSnapshot = (experimentId: string, agent: string, dirSuffix: string): Snapshot => {
    const dir = `/results/${dirSuffix}`;
    const base = {
      experimentId,
      startedAt: "2026-07-01T10:00:00Z",
      completedAt: "2026-07-01T10:05:00Z",
      agent,
      schemaVersion: 1,
      dir,
    };
    const attempt = {
      evalId: "algebra/x",
      experimentId,
      result: {
        id: "algebra/x",
        agent,
        verdict: "passed" as const,
        attempt: 0,
        startedAt: "2026-07-01T10:00:00Z",
        durationMs: 1000,
        assertions: [],
      },
      ref: { snapshot: dirSuffix, attempt: "algebra/x/a0" },
      snapshot: base,
      events: async () => null,
      trace: async () => null,
      o11y: async () => null,
      diff: async () => null,
      sources: async () => null,
    };
    return {
      ...base,
      evals: [{ id: attempt.evalId, attempts: [attempt] }],
      attempts: [attempt],
    } as unknown as Snapshot;
  };

  const snapshots = [
    mkSnapshot("compare/bub", "bub", "compare_bub/snap-1"),
    mkSnapshot("other/codex", "codex", "other_codex/snap-1"),
    mkSnapshot("solo", "bub", "solo/snap-1"),
  ];

  const makeSelection = (snaps: Snapshot[]): Selection => ({
    snapshots: snaps,
    warnings: [],
    filter: (predicate) => makeSelection(snaps.filter(predicate)),
  });
  const selection = makeSelection(snapshots);
  const results = {
    experiments: snapshots.map((s) => ({
      id: s.experimentId,
      snapshots: [s],
      latest: s,
      evalIds: ["algebra/x"],
    })),
    skipped: [],
    latest: () => selection,
  } as Results;
  return { selection, results };
}

describe("<DefaultReport /> failing board · 原因优先级", () => {
  const report = defineReport(async () => (
    <Col>
      <DefaultReport />
    </Col>
  ));

  it("error 优先于失败 gate 与失败 soft", async () => {
    const ctx = fakeContextWithReason({
      error: "adapter crashed",
      assertions: [
        { name: "includes", severity: "gate", score: 0, passed: false, detail: "missing text" },
        { name: "judge", severity: "soft", score: 0.2, passed: false },
      ],
    });
    const out = await renderReportToText(report, ctx, { width: 100 });
    expect(out).toContain("adapter crashed");
    expect(out).not.toContain("includes");
  });

  it("多个失败 gate 按原始声明顺序拼接;失败 soft 不出现在原因里", async () => {
    const ctx = fakeContextWithReason({
      assertions: [
        { name: "judge-first", severity: "soft", score: 0.1, passed: false },
        { name: "includes", severity: "gate", score: 0, passed: false, detail: "missing text" },
        { name: "matches", severity: "gate", score: 0, passed: false },
      ],
    });
    const out = await renderReportToText(report, ctx, { width: 100 });
    expect(out).toContain("includes: missing text, matches");
    expect(out).not.toContain("judge-first");
  });

  it("errored 没有断言时仍显示 error(不需要 assertions 才有原因)", async () => {
    const errored = await renderReportToText(
      report,
      fakeContextWithReason({ verdict: "errored", error: "ENOENT tool" }),
      { width: 100 },
    );
    expect(errored).toContain("ENOENT tool");
  });
});

describe("defineReport + 渲染入口", () => {
  const report = defineReport(async ({ selection }) => (
    <Col>
      <DefaultReport />
      <Section title="考试成绩单">
        <Scoreboard data={await Scoreboard.data(selection, { rows: "agent", subjects: "evalGroup" })} />
      </Section>
    </Col>
  ));

  it("isReportDefinition 识别产物;非函数报错", () => {
    expect(isReportDefinition(report)).toBe(true);
    expect(isReportDefinition({})).toBe(false);
    // @ts-expect-error 非函数
    expect(() => defineReport(42)).toThrow(/expects a build function/);
  });

  it("renderReportToText:同一棵树走 text 面,DefaultReport 渲染宿主注入的 Selection", async () => {
    const out = await renderReportToText(report, fakeContext(), { width: 100 });
    // 官方水位 = show 榜单(viewing-results.mdx):Current verdicts 头 + experiment 榜单 + 失败清单
    expect(out).toContain("Current verdicts · 1 experiment · composed from 1 run");
    expect(out).toContain("experiment");
    expect(out).toContain("evals");
    expect(out).toContain("compare/bub");
    expect(out).toContain("1/2"); // eval 级折叠计票
    expect(out).toContain("50%");
    expect(out).toContain("Failing:");
    expect(out).toContain("✗ algebra/y");
    expect(out).toContain("→ niceeval show algebra/y"); // 失败清单每条自带下钻命令
    // 自己的口径:成绩单
    expect(out).toContain("考试成绩单");
    expect(out).toContain("bub     50/100");
  });

  it("renderReportToStaticHtml:同一棵树走 web 面,官方组件自动接证据室深链", async () => {
    const html = await renderReportToStaticHtml(report, fakeContext());
    expect(html).toContain("nre-default-report");
    expect(html).toContain("nre-scoreboard");
    expect(html).toContain("考试成绩单");
    // 宿主注入的 attemptHref:CaseList 的下钻是普通 <a>,默认 view 路由
    expect(html).toContain('href="#/attempt/compare_bub/snap-1/algebra/y/a0"');
    expect(html).not.toContain("<script");
  });

  it("树里混进 <div>:两个宿主渲染前同一遍校验拦住", async () => {
    const bad = defineReport(() => (
      <Col>
        <div>nope</div>
      </Col>
    ));
    await expect(renderReportToText(bad, fakeContext())).rejects.toThrow(/Raw HTML <div>/);
    await expect(renderReportToStaticHtml(bad, fakeContext())).rejects.toThrow(/Raw HTML <div>/);
  });

  it("<DefaultReport /> 在宿主之外渲染:一句直说的错误", () => {
    expect(() => renderToStaticMarkup(<DefaultReport />)).toThrow(/renders the host-injected selection/);
  });
});

// ───────────────────────── defaultReport(内置默认报告)─────────────────────────

describe("defaultReport", () => {
  it("是普通 ReportDefinition;text 面 = RunOverview + 分组 Experiment 工作台 + 失败诊断", async () => {
    expect(isReportDefinition(defaultReport)).toBe(true);
    const out = await renderReportToText(defaultReport, fakeContext(), { width: 100 });
    // 顶部 RunOverview
    expect(out).toContain("1 experiment · 2 evals · 2 attempts");
    // "compare/bub" 的组是 "compare":Section 标题;组内可画点 <2(无成本数据),scatter 省略
    expect(out).toContain("compare\n");
    expect(out).not.toContain("better → upper right");
    // 工作台主行用短名,完整 experiment id 不挤进主表;Agent 与 eval 级折叠计票保留
    expect(out).toContain("bub");
    expect(out).toContain("Agent");
    expect(out).toContain("Result");
    expect(out).toContain("1 passed / 1 failed");
    // 失败/错误诊断随所属 experiment 输出
    expect(out).toContain("✗ algebra/y");
  });

  it("web 面:整行 details 工作台 + 过滤/排序属性 + 展开诊断结构,主行无 refs", async () => {
    const html = await renderReportToStaticHtml(defaultReport, fakeContext());
    expect(html).toContain("nre-section");
    expect(html).toContain(">compare</h2>");
    expect(html).toContain("data-nre-experiment-filter");
    expect(html).toContain("data-nre-experiment-sort");
    expect(html).toContain('<details class="nre-experiment-entry">');
    expect(html).toContain('<summary class="nre-experiment-summary">');
    expect(html).toContain("nre-experiment-config");
    expect(html).toContain("nre-experiment-kpis");
    expect(html).toContain("nre-experiment-evals");
    expect(html).toContain("nre-experiment-raw");
    expect(html).toContain("nre-experiment-pill");
    expect(html).not.toContain("nre-subrows-summary");
    expect(html).not.toContain("nre-ref");
    expect(html).not.toContain("<script");
  });

  it("locale 管线:web 面 zh-CN 走字典(chrome 与内置指标 label),text 面默认 en 不变", async () => {
    const zh = await renderReportToStaticHtml(defaultReport, fakeContext(), { locale: "zh-CN" });
    expect(zh).toContain("成功率"); // passRate 的 zh-CN label
    expect(zh).toContain('placeholder="筛选实验…"');
    expect(zh).toContain("通过 1"); // RunOverview 的 verdict 词
    const zhText = await renderReportToText(defaultReport, fakeContext(), { locale: "zh-CN" });
    expect(zhText).toContain("1 个实验");
    expect(zhText).toContain("成功率");
  });

  it("grouped 与 ungrouped snapshots 混合:所有组和无分组实验都出现一次,组间保留空行", async () => {
    const out = await renderReportToText(defaultReport, fakeMultiGroupContext(), { width: 100 });
    // 两个具名组的 Section 标题各自只出现一次(标题独占一行)
    expect(out.match(/^compare$/m) ?? []).toHaveLength(1);
    expect(out.match(/^other$/m) ?? []).toHaveLength(1);
    // 无组实验直接平铺相同 blocks,不发明虚构组名/标题
    expect(out).toContain("solo");
    expect(out).not.toContain("(ungrouped)");
    // 三个 experiment 的短名主行都出现过一次
    expect(out).toMatch(/^\s*bub\s+/m);
    expect(out).toMatch(/^\s*codex\s+/m);
    // 组与组之间(text 面)保留 Col 的段落空行分隔,不因为 sections 数组被当成
    // <Col> 单个子节点整体传入而在内层退化成单换行(nested-array 折叠 bug 回归)
    expect(out).toMatch(/\n\nother\n/);
  });
});
