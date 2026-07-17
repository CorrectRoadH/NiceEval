// cases: docs/engineering/unit-tests/reports/cases.md
// 「外壳、页面与 Tabs」——宿主装载规范化、页索引命令上下文与标题回退链
// (契约:docs/feature/reports/library/shell.md)。
// 页内树的 resolve / render 归报告库测试;这里只测宿主侧的规范化与选择逻辑(纯函数)。

import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PAGE_TITLE,
  BUILT_IN_REPORT_TITLE,
  HostReportError,
  loadHostReport,
  localizeText,
  localizedTextEquals,
  normalizeHostReport,
  resolveReportTitle,
  showCommand,
} from "./report-host.ts";
import { otherPagesText } from "./render.ts";
// dist-sourced:裸宿主装载的就是这份预编译产物的默认导出(show 与 view 同一条路),
// raw-src import 会是另一份模块实例,引用等同断言必须对着 dist。
import distBuiltInReport from "../../dist/report/built-in/index.js";

const tree = { kind: "node" }; // 页 content 对宿主是不透明值,规范化不解析树

describe("裸宿主装载内建报告", () => {
  it("缺省(无 --report)装载 niceeval/report/built-in 的默认导出:三页与其 content 同引用", async () => {
    const host = await loadHostReport(process.cwd(), undefined);
    const builtIn = distBuiltInReport as { pages: readonly { id: string; content: unknown }[] };
    expect(host.pages.map((p) => p.id)).toEqual(["report", "attempts", "traces"]);
    expect(builtIn.pages.map((p) => p.id)).toEqual(["report", "attempts", "traces"]);
    for (let i = 0; i < host.pages.length; i++) {
      expect(host.pages[i]!.content).toBe(builtIn.pages[i]!.content); // 同一份默认导出,不是复制品
    }
  });
});

describe("装载规范化:外壳 + 非空页列表", () => {
  it("content 缩写展开为唯一页 id `report`,页名是内置页名「报告 / Report」", () => {
    const report = normalizeHostReport({ kind: "report", content: tree }, "reports/frontier.tsx");
    expect(report.pages).toHaveLength(1);
    expect(report.pages[0]).toMatchObject({ id: "report", title: BUILT_IN_PAGE_TITLE, content: tree });
    expect(report.links).toEqual([]);
  });

  it("pages 形态按声明序保留页列表与外壳字段", () => {
    const report = normalizeHostReport(
      {
        kind: "report",
        title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
        links: [{ label: "GitHub", href: "https://example.com" }],
        footer: "Published nightly.",
        pages: [
          { id: "overview", title: { en: "Overview", "zh-CN": "总览" }, content: tree },
          { id: "exam", title: { en: "Exam", "zh-CN": "成绩单" }, content: tree },
        ],
      },
      "reports/site.tsx",
    );
    expect(report.pages.map((p) => p.id)).toEqual(["overview", "exam"]);
    expect(report.title).toEqual({ en: "Memory Evals", "zh-CN": "记忆能力评测" });
    expect(report.footer).toBe("Published nightly.");
  });

  it("content 与 pages 恰好声明一个:同给 / 同缺都报错,文案给出 <ExperimentComparison /> 下一步", () => {
    for (const bad of [
      { kind: "report", content: tree, pages: [{ id: "a", title: "A", content: tree }] },
      { kind: "report", title: "T" },
    ]) {
      expect(() => normalizeHostReport(bad, "reports/site.tsx")).toThrow(HostReportError);
      expect(() => normalizeHostReport(bad, "reports/site.tsx")).toThrow(/<ExperimentComparison \/>/);
    }
  });

  it("空 pages 列表 / 重复 page id / 非法 page id 在装载期报错", () => {
    expect(() => normalizeHostReport({ kind: "report", pages: [] }, "r.tsx")).toThrow(/non-empty/);
    expect(() =>
      normalizeHostReport(
        { kind: "report", pages: [{ id: "exam", title: "A", content: tree }, { id: "exam", title: "B", content: tree }] },
        "r.tsx",
      ),
    ).toThrow(/duplicate page id "exam"/);
    for (const id of ["Exam", "a/b"]) {
      expect(() =>
        normalizeHostReport({ kind: "report", pages: [{ id, title: "A", content: tree }] }, "r.tsx"),
      ).toThrow(/invalid/);
    }
  });

  it("默认导出不是 defineReport 产物:完整用户反馈", () => {
    expect(() => normalizeHostReport({ some: "object" }, "reports/bad.tsx")).toThrow(
      /does not default-export a report/,
    );
  });

  it("ReportLink.icon 是 { svg: string }:合法形状原样透传;无类型 JS 传其它形状装载报错", () => {
    const svg = '<svg viewBox="0 0 16 16"><path d="M0 0h16v16z"/></svg>';
    const report = normalizeHostReport(
      { kind: "report", content: tree, links: [{ label: "GitHub", href: "https://example.com", icon: { svg } }] },
      "reports/site.tsx",
    );
    expect(report.links[0]!.icon).toEqual({ svg });

    // ReactNode / 组件 / 裸字符串都不是 { svg: string },装载期以完整用户反馈拒绝。
    const reactNode = { $$typeof: Symbol.for("react.transitional.element"), type: "svg", props: {} };
    for (const icon of [reactNode, "<svg/>", { svg: 42 }, { svg: "" }]) {
      expect(() =>
        normalizeHostReport(
          { kind: "report", content: tree, links: [{ label: "GitHub", href: "https://example.com", icon }] },
          "reports/site.tsx",
        ),
      ).toThrow(/icon" must be \{ svg: string \}/);
    }
  });

  it("旧 build 函数形态(集成前桥接)恒为单页 report", () => {
    const legacy = { build: () => tree };
    const report = normalizeHostReport(legacy, "the built-in report");
    expect(report.pages.map((p) => p.id)).toEqual(["report"]);
    expect(report.pages[0]!.content).toBe(legacy);
  });
});

describe("标题回退链:def.title → 唯一且相同的快照 name → 内置文案「Eval 运行结果 / Eval Results」", () => {
  it("def.title 优先", () => {
    expect(resolveReportTitle({ en: "T" }, [{ name: "S" }])).toEqual({ en: "T" });
  });

  it("无 def.title 时取 Scope 中唯一且相同(深相等,键顺序无关)的非空快照 name", () => {
    expect(resolveReportTitle(undefined, [{ name: { en: "S", "zh-CN": "斯" } }, { name: { "zh-CN": "斯", en: "S" } }]))
      .toEqual({ en: "S", "zh-CN": "斯" });
    expect(resolveReportTitle(undefined, [{}, { name: "Only" }])).toBe("Only");
  });

  it("多个不同 name(en 相同、zh-CN 不同也算不同)不随机挑,落内置文案;全无 name 亦然", () => {
    expect(
      resolveReportTitle(undefined, [{ name: { en: "S", "zh-CN": "甲" } }, { name: { en: "S", "zh-CN": "乙" } }]),
    ).toEqual(BUILT_IN_REPORT_TITLE);
    expect(resolveReportTitle(undefined, [{}, {}])).toEqual(BUILT_IN_REPORT_TITLE);
    expect(resolveReportTitle("", [])).toEqual(BUILT_IN_REPORT_TITLE); // 空串标题不算声明
    // 链终点是内置文案(shell.md),不是产品名——品牌位固定 NiceEval,不吃标题。
    expect(BUILT_IN_REPORT_TITLE).toEqual({ en: "Eval Results", "zh-CN": "Eval 运行结果" });
  });

  it("LocalizedText 深相等按字段值,不看键顺序", () => {
    expect(localizedTextEquals({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(localizedTextEquals({ a: "1" }, { a: "1", b: "2" })).toBe(false);
  });
});

describe("LocalizedText 回退:locale → en → 键字典序第一个非空值", () => {
  it("三级回退各自命中", () => {
    expect(localizeText({ "zh-CN": "中", en: "E" }, "zh-CN")).toBe("中");
    expect(localizeText({ "zh-CN": "中", en: "E" }, "fr")).toBe("E");
    expect(localizeText({ "zh-TW": "繁", ja: "日" }, "en")).toBe("日"); // ja < zh-TW 字典序
    expect(localizeText("plain", "en")).toBe("plain");
    expect(localizeText({}, "en")).toBeUndefined();
  });
});

describe("其余页索引与索引命令上下文", () => {
  const report = normalizeHostReport(
    {
      kind: "report",
      title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
      links: [{ label: "GitHub", href: "https://example.com", icon: { svg: "<svg data-mark></svg>" } }],
      pages: [
        { id: "overview", title: { en: "Overview", "zh-CN": "总览" }, content: tree },
        { id: "exam", title: { en: "Exam", "zh-CN": "成绩单" }, content: tree },
      ],
    },
    "reports/site.tsx",
  );

  it("只列未渲染的页,索引命令保留当前 --results / --report 与位置参数,复制即可复现下一层视图", () => {
    // 渲染的是 overview,其余页索引只含 exam 一行——与「渲染初始页 + 尾部附其余页索引」
    // 的新行为一致(docs/feature/reports/show/reports.md Case 2)。
    const text = otherPagesText({
      otherPages: report.pages.filter((p) => p.id !== "overview").map((p) => ({ id: p.id, title: p.title })),
      command: { patterns: [], results: "tmp/published-results", report: "reports/site.tsx" },
      locale: "zh-CN",
    });
    expect(text).toContain("其余页：");
    expect(text).toContain("niceeval show --results tmp/published-results --report reports/site.tsx --page exam");
    expect(text).toContain("成绩单");
    expect(text).not.toContain("总览");
    expect(text).not.toContain("--page overview");
  });

  it("show 不消费 links:其余页索引不含 icon svg 与 href(icon 是 web 面属性)", () => {
    const text = otherPagesText({
      otherPages: report.pages.filter((p) => p.id !== "overview").map((p) => ({ id: p.id, title: p.title })),
      command: { patterns: [] },
      locale: "en",
    });
    expect(text).toContain("Other pages:");
    expect(text).not.toContain("<svg");
    expect(text).not.toContain("https://example.com");
  });

  it("showCommand 按序携带位置参数与 --experiment / --results / --report / --page", () => {
    expect(
      showCommand({ patterns: ["memory/swelancer"], experiment: "dev-e2b", report: "reports/site.tsx", page: "exam" }),
    ).toBe("niceeval show memory/swelancer --experiment dev-e2b --report reports/site.tsx --page exam");
  });
});
