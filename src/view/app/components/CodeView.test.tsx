// @vitest-environment jsdom
// cases: docs/engineering/unit-tests/reports/cases.md
// 「Attempt 详情(view 证据室)」分区——
// 源码视图是判定与断言的单点:带 loc 的 send 行可点开查看该轮回复(assistant 文本 / thinking),
// 失败断言行默认展开、展开面直接给 matcher 与 expected / received 的值。
// 这组测试在 jsdom 里跑真实点击,守住「统一站点管线之后弹窗证据链仍然可用」的行为面
// (数据侧的字节奇偶由 src/view/site-parity.test.ts 守护,两头合起来 = 线上站点可用)。

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CodeView } from "./CodeView.tsx";
import { makeTranslator } from "../i18n.ts";
import type { Assertion, CodeSource, TranscriptEvent } from "../types.ts";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const t = makeTranslator("en");

const FILE = "evals/a.eval.ts";
const SOURCE: CodeSource = {
  path: FILE,
  content: [
    "import { defineEval } from \"niceeval\";",
    "",
    "await t.send(\"do the task\");",
    "",
    "t.check(source, includes(/use cache/));",
  ].join("\n"),
};

const EVENTS: TranscriptEvent[] = [
  { type: "message", role: "user", text: "do the task", loc: { file: FILE, line: 3 } },
  { type: "thinking", text: "THINKING_MARKER" },
  { type: "message", role: "assistant", text: "REPLY_TEXT_MARKER" },
];

const FAILED_ASSERT: Assertion = {
  name: "Catalog reads use cache",
  detail: "includes(/use cache/)",
  severity: "gate",
  outcome: "failed",
  score: 0,
  expected: "/use cache/",
  received: "RECEIVED_VALUE_MARKER",
  loc: { file: FILE, line: 5 },
};

let container: HTMLElement | undefined;
let root: Root | undefined;

function render(ui: React.ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 按行号取源码行的 DOM 节点(.code-line 里第一个 .ln 是行号)。 */
function lineEl(host: HTMLElement, n: number): Element {
  const row = [...host.querySelectorAll(".code-line")].find((el) => el.querySelector(".ln")?.textContent === String(n));
  expect(row, `source line ${n}`).toBeTruthy();
  return row!;
}

describe("CodeView · send 行的回复展开", () => {
  it("带 loc 的 send 行可点开:回复面板显示 assistant 文本与 thinking;再点收起", () => {
    const host = render(<CodeView sources={[SOURCE]} events={EVENTS} assertions={[]} t={t} />);

    const sendLine = lineEl(host, 3);
    expect(sendLine.className).toContain("line-send");
    // 初始未展开:回复不可见。
    expect(host.textContent).not.toContain("REPLY_TEXT_MARKER");

    click(sendLine);
    expect(host.querySelector(".reply-panel")).toBeTruthy();
    expect(host.textContent).toContain("REPLY_TEXT_MARKER");
    expect(host.textContent).toContain("THINKING_MARKER");

    click(lineEl(host, 3));
    expect(host.textContent).not.toContain("REPLY_TEXT_MARKER");
  });

  it("send 轮没有任何回复事件时,展开面如实显示「无回复」而不是空白", () => {
    const onlySend: TranscriptEvent[] = [EVENTS[0]!];
    const host = render(<CodeView sources={[SOURCE]} events={onlySend} assertions={[]} t={t} />);
    click(lineEl(host, 3));
    expect(host.querySelector(".reply-empty")?.textContent).toBe(t("code.noReply"));
  });
});

describe("CodeView · 断言行的明细展开", () => {
  it("第一条失败断言默认展开:matcher 与 expected / received 的值直接可见,点行可收起", () => {
    const host = render(<CodeView sources={[SOURCE]} events={EVENTS} assertions={[FAILED_ASSERT]} t={t} />);

    const assertLine = lineEl(host, 5);
    expect(assertLine.className).toContain("line-fail");
    // 默认展开(第一条 failed):不点任何东西就能看到为什么失败。
    expect(host.textContent).toContain("includes(/use cache/)");
    expect(host.textContent).toContain("/use cache/");
    expect(host.textContent).toContain("RECEIVED_VALUE_MARKER");

    click(assertLine);
    expect(host.textContent).not.toContain("RECEIVED_VALUE_MARKER");
  });

  it("passed 断言行不默认展开,点开后显示明细", () => {
    const passed: Assertion = { ...FAILED_ASSERT, outcome: "passed", score: 1, loc: { file: FILE, line: 5 } };
    delete (passed as { expected?: string }).expected;
    delete (passed as { received?: string }).received;
    const host = render(<CodeView sources={[SOURCE]} events={EVENTS} assertions={[passed]} t={t} />);

    const assertLine = lineEl(host, 5);
    expect(assertLine.className).toContain("line-pass");
    expect(host.querySelector(".line-detail")).toBeNull();

    click(assertLine);
    expect(host.querySelector(".line-detail")).toBeTruthy();
    expect(host.textContent).toContain("includes(/use cache/)");
  });
});
