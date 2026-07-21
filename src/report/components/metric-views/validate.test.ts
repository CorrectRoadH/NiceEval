// cases: docs/engineering/testing/unit/reports.md
// "validate*Data 递归覆盖到嵌套字段" 行:metric-views 六个 validate*Data 的表驱动字段突变覆盖,每个校验函数先证明合规 literal 通过,
// 再对嵌套字段(MetricColumn / MetricCell / tally)逐个突变,证明报错文案定位到具体坏字段
// 路径而不是笼统的整份 data 报错。不复制 compute.ts 的聚合逻辑——fixture 是手写的合规
// literal,不经由真实计算产出。

import { describe, expect, it } from "vitest";
import {
  validateDeltaData,
  validateLineData,
  validateMatrixData,
  validateScatterData,
  validateScoreboardData,
  validateTableData,
} from "./index.tsx";

const validCell = { value: 1, display: "1", samples: 1, total: 1, refs: ["@1abcdef2"] };
const validColumn = { key: "costUSD", label: "Cost" };

describe("validateTableData", () => {
  const valid = {
    rowDimension: "agent",
    columns: [validColumn],
    rows: [{ key: "agent-x", cells: { costUSD: validCell } }],
  };

  it("合规 literal 通过", () => {
    expect(validateTableData(valid)).toBeNull();
  });

  it("空 rows 本身合法", () => {
    expect(validateTableData({ ...valid, rows: [] })).toBeNull();
  });

  it("columns[i] 缺 key 报错定位到该列", () => {
    const bad = { ...valid, columns: [{ label: "Cost" }] };
    expect(validateTableData(bad)).toMatch(/"columns\[0\]\.key"/);
  });

  it("rows[i].cells.<metric> 缺 samples 报错定位到嵌套 MetricCell 字段", () => {
    const bad = {
      ...valid,
      rows: [{ key: "agent-x", cells: { costUSD: { value: 1, display: "1", total: 1, refs: [] } } }],
    };
    expect(validateTableData(bad)).toMatch(/"rows\[0\]\.cells\.costUSD\.samples"/);
  });

  it("rows[i].key 非字符串报错", () => {
    const bad = { ...valid, rows: [{ key: 1, cells: {} }] };
    expect(validateTableData(bad)).toMatch(/"rows\[0\]\.key"/);
  });

  it("旧形状(dimension 而非 rowDimension)整体报错", () => {
    expect(validateTableData({ dimension: "agent", columns: [], rows: [] })).toMatch(/rowDimension/);
  });
});

describe("validateMatrixData", () => {
  const valid = {
    rowDimension: "agent",
    columnDimension: "eval",
    metric: validColumn,
    cells: [{ row: "agent-x", column: "q1", cell: validCell }],
  };

  it("合规 literal 通过", () => {
    expect(validateMatrixData(valid)).toBeNull();
  });

  it("metric 缺 label 报错", () => {
    expect(validateMatrixData({ ...valid, metric: { key: "costUSD" } })).toMatch(/"metric\.label"/);
  });

  it("cells[i].cell 结构错误定位到该格", () => {
    const bad = { ...valid, cells: [{ row: "agent-x", column: "q1", cell: { value: 1 } }] };
    expect(validateMatrixData(bad)).toMatch(/"cells\[0\]\.cell/);
  });

  it("cells[i].column 非字符串报错", () => {
    const bad = { ...valid, cells: [{ row: "agent-x", column: 1, cell: validCell }] };
    expect(validateMatrixData(bad)).toMatch(/"cells\[0\]\.column"/);
  });
});

describe("validateScatterData", () => {
  const valid = {
    pointDimension: "experiment",
    x: validColumn,
    y: { key: "endToEndPassRate", label: "Pass rate" },
    rows: [{ key: "exp-a", x: validCell, y: validCell }],
  };

  it("合规 literal 通过", () => {
    expect(validateScatterData(valid)).toBeNull();
  });

  it("y 轴 MetricColumn 缺 key 报错", () => {
    expect(validateScatterData({ ...valid, y: { label: "Pass rate" } })).toMatch(/"y\.key"/);
  });

  it("rows[i].y 结构错误定位到该点", () => {
    const bad = { ...valid, rows: [{ key: "exp-a", x: validCell, y: { value: 1 } }] };
    expect(validateScatterData(bad)).toMatch(/"rows\[0\]\.y/);
  });
});

describe("validateLineData", () => {
  const valid = {
    x: { key: "turn", label: "Turn" },
    y: validColumn,
    rows: [{ key: "1", x: 1, y: validCell, xDisplay: "1" }],
  };

  it("合规 literal 通过", () => {
    expect(validateLineData(valid)).toBeNull();
  });

  it("x 轴缺 label 报错", () => {
    expect(validateLineData({ ...valid, x: { key: "turn" } })).toMatch(/"x" must be an axis descriptor/);
  });

  it("rows[i].x 类型错误(非 number|null)报错", () => {
    const bad = { ...valid, rows: [{ key: "1", x: "1", y: validCell, xDisplay: "1" }] };
    expect(validateLineData(bad)).toMatch(/"rows\[0\]\.x"/);
  });

  it("rows[i].y 缺失报错定位到嵌套 MetricCell", () => {
    const bad = { ...valid, rows: [{ key: "1", x: 1, xDisplay: "1" }] };
    expect(validateLineData(bad)).toMatch(/"rows\[0\]\.y"/);
  });
});

describe("validateScoreboardData", () => {
  const validSubject = {
    key: "security",
    earned: 1,
    possible: 1,
    questions: 1,
    notRun: 0,
    unscorable: 0,
    display: "100%",
    refs: [],
  };
  const valid = {
    rowDimension: "agent",
    questions: ["q1"],
    fullMarks: 100,
    ignoredEvals: 0,
    rows: [
      {
        key: "agent-x",
        total: { value: 100, display: "100%", notRun: 0, unscorable: 0, refs: [] },
        subjects: [validSubject],
      },
    ],
  };

  it("合规 literal 通过", () => {
    expect(validateScoreboardData(valid)).toBeNull();
  });

  it("rows[i].total 缺 notRun 报错", () => {
    const bad = {
      ...valid,
      rows: [{ ...valid.rows[0], total: { value: 100, display: "100%", unscorable: 0, refs: [] } }],
    };
    expect(validateScoreboardData(bad)).toMatch(/"rows\[0\]\.total\.notRun"/);
  });

  it("rows[i].subjects[j] 缺 possible 报错定位到该 subject 下标", () => {
    const bad = {
      ...valid,
      rows: [{ ...valid.rows[0], subjects: [{ ...validSubject, possible: undefined }] }],
    };
    expect(validateScoreboardData(bad)).toMatch(/"rows\[0\]\.subjects\[0\]\.possible"/);
  });
});

describe("validateDeltaData", () => {
  const validDeltaCell = { a: validCell, b: validCell, delta: 0, display: "±0", outcome: "unchanged" };
  const valid = {
    byDimension: "flag",
    columns: [validColumn],
    rows: [{ key: "codex", label: "codex", a: { key: "baseline" }, b: { key: "agents-md" }, cells: { costUSD: validDeltaCell } }],
  };

  it("合规 literal 通过", () => {
    expect(validateDeltaData(valid)).toBeNull();
  });

  it("cells.<metric>.outcome 不在枚举内报错", () => {
    const bad = {
      ...valid,
      rows: [{ ...valid.rows[0], cells: { costUSD: { ...validDeltaCell, outcome: "flat" } } }],
    };
    expect(validateDeltaData(bad)).toMatch(/"rows\[0\]\.cells\.costUSD\.outcome"/);
  });

  it("cells.<metric>.a 结构错误定位到该侧", () => {
    const bad = {
      ...valid,
      rows: [{ ...valid.rows[0], cells: { costUSD: { ...validDeltaCell, a: { value: 1 } } } }],
    };
    expect(validateDeltaData(bad)).toMatch(/"rows\[0\]\.cells\.costUSD\.a/);
  });

  it("rows[i].label 缺失报错", () => {
    const bad = { ...valid, rows: [{ key: "codex", a: { key: "baseline" }, b: { key: "agents-md" }, cells: {} }] };
    expect(validateDeltaData(bad)).toMatch(/"rows\[0\]\.label"/);
  });
});
