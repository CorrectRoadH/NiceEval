// cases: docs/engineering/unit-tests/reports/cases.md
// "validate*Data 递归覆盖到嵌套字段" 行:entity-lists 三个 validate*Data 的表驱动字段突变覆盖,AttemptListItem 的形状在三个组件族
// 共用(独立 data 或嵌套在 evalRows/attempts 里),重点覆盖嵌套 MetricCell/tally 字段与
// 深层嵌套(ExperimentListItem.evalRows[i].attempts[j])的路径定位。

import { describe, expect, it } from "vitest";
import { validateAttemptListData, validateEvalListData, validateExperimentListData } from "./index.tsx";

const validCell = { value: 1, display: "1", samples: 1, total: 1, refs: [] };
const validTally = { passed: 1, failed: 0, errored: 0, skipped: 0 };

const validAttemptItem = {
  experimentId: "compare/codex",
  evalId: "q1",
  attempt: 0,
  agent: "codex",
  verdict: "passed",
  failureSummary: null,
  moreFailures: 0,
  examScore: validCell,
  durationMs: 1000,
  costUSD: 0.01,
  locator: "@1abcdef2",
};

describe("validateAttemptListData", () => {
  it("合规 literal 通过,costUSD 为 null 与 failureSummary 为 null 合法", () => {
    expect(validateAttemptListData([{ ...validAttemptItem, costUSD: null }])).toBeNull();
  });

  it("非数组整体报错", () => {
    expect(validateAttemptListData({})).toMatch(/"data" must be an array/);
  });

  it("[i].examScore 结构错误定位到嵌套 MetricCell 字段", () => {
    const bad = [{ ...validAttemptItem, examScore: { value: 1 } }];
    expect(validateAttemptListData(bad)).toMatch(/"data\[0\]\.examScore\.display"/);
  });

  it("[i].verdict 非字符串报错", () => {
    const bad = [{ ...validAttemptItem, verdict: 1 }];
    expect(validateAttemptListData(bad)).toMatch(/"data\[0\]\.verdict"/);
  });
});

describe("validateEvalListData", () => {
  const valid = [
    {
      experimentId: "compare/codex",
      evalId: "q1",
      verdict: "passed",
      examScore: validCell,
      durationMs: validCell,
      costUSD: validCell,
      attempts: [validAttemptItem],
    },
  ];

  it("合规 literal 通过", () => {
    expect(validateEvalListData(valid)).toBeNull();
  });

  it("[i].durationMs(MetricCell)结构错误报错", () => {
    const bad = [{ ...valid[0], durationMs: { value: 1, display: "1", samples: 1, total: 1 } }];
    expect(validateEvalListData(bad)).toMatch(/"data\[0\]\.durationMs\.refs"/);
  });

  it("[i].attempts[j] 嵌套 AttemptListItem 结构错误定位到深层下标", () => {
    const bad = [{ ...valid[0], attempts: [{ ...validAttemptItem, locator: 1 }] }];
    expect(validateEvalListData(bad)).toMatch(/"data\[0\]\.attempts\[0\]\.locator"/);
  });
});

describe("validateExperimentListData", () => {
  const validEvalRow = { evalId: "q1", verdict: "passed", durationMs: validCell, costUSD: validCell, attempts: [validAttemptItem] };
  const valid = [
    {
      experimentId: "compare/codex",
      agent: "codex",
      evalVerdicts: validTally,
      endToEndPassRate: validCell,
      costUSD: validCell,
      durationMs: validCell,
      tokens: validCell,
      evals: 1,
      attempts: 1,
      lastRunAt: "2026-07-01T00:00:00Z",
      evalRows: [validEvalRow],
    },
  ];

  it("合规 literal 通过", () => {
    expect(validateExperimentListData(valid)).toBeNull();
  });

  it("[i].evalVerdicts(四态 tally)缺字段报错", () => {
    const bad = [{ ...valid[0], evalVerdicts: { passed: 1, failed: 0, errored: 0 } }];
    expect(validateExperimentListData(bad)).toMatch(/"data\[0\]\.evalVerdicts\.skipped"/);
  });

  it("[i].evalRows[j].attempts[k] 三层嵌套报错精确定位", () => {
    const bad = [
      {
        ...valid[0],
        evalRows: [{ ...validEvalRow, attempts: [{ ...validAttemptItem, examScore: null }] }],
      },
    ];
    expect(validateExperimentListData(bad)).toMatch(/"data\[0\]\.evalRows\[0\]\.attempts\[0\]\.examScore"/);
  });

  it("model / flags 可选字段省略仍合法", () => {
    expect(validateExperimentListData(valid)).toBeNull();
  });
});
