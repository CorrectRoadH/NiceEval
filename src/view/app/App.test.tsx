// cases: docs/engineering/testing/unit/reports/cases.md
// 「外壳、页面与 Tabs」分区——
// 宿主页头不渲染任何品牌位、宿主无 hero 区(hero / 品牌行是页内组件,见 site-components 测试);
// view 导航只有报告定义声明的页(声明序),宿主不追加或保留任何导航项;
// ReportLink.icon 渲染在 label 前(web 面)。契约:docs/feature/reports/library/shell.md「行为约束」、
// docs/feature/reports/view.md「页面构成」。

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import type { ViewData } from "./types.ts";

beforeAll(() => {
  // App 的初始状态读 location(hash 路由 / 旧版 ?modal=);node 下静态渲染补最小 stub。
  (globalThis as { location?: unknown }).location = { hash: "", search: "", pathname: "/" };
});

const reportPages = {
  report: { en: "<p>REPORT_BODY</p>", "zh-CN": "<p>REPORT_BODY</p>" },
  attempts: { en: "<p>ATTEMPTS_BODY</p>", "zh-CN": "<p>ATTEMPTS_BODY</p>" },
  traces: { en: "<p>TRACES_BODY</p>", "zh-CN": "<p>TRACES_BODY</p>" },
};

function dataWithShell(report: ViewData["report"]): ViewData {
  return { composedRuns: 1, ...(report !== undefined ? { report } : {}) };
}

describe("外壳:宿主恒有 NiceEval 品牌位、无 hero,导航只有报告页", () => {
  it("宿主页头有恒定品牌字标、无 hero 区:hero 是页内组件不归宿主,品牌归宿主", () => {
    const html = renderToStaticMarkup(
      <App
        data={dataWithShell({
          title: { en: "Memory Evals", "zh-CN": "记忆能力评测" },
          links: [],
          pages: [{ id: "report", title: "Report" }],
          initialPageId: "report",
        })}
        reportPages={reportPages}
      />,
    );
    // 宿主页头恒有 NiceEval 品牌字标,外链官网;报告定义不能覆盖或移除。
    expect(html).toContain('class="brand"');
    expect(html).toContain("NiceEval");
    expect(html).toContain("niceeval.com");
    // 品牌位是页头字标,不是 hero 的 Powered by 行——后者是页内组件,不落宿主壳。
    expect(html).not.toContain("Powered by");
    // 宿主无 hero 区:标题只落浏览器 <title>(useEffect,静态渲染不执行),不落任何宿主节点。
    expect(html).not.toContain('class="hero"');
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("Memory Evals");
  });

  it("导航项 = 报告定义声明的页,按声明序;宿主不追加 Attempts / Traces 等任何项", () => {
    const html = renderToStaticMarkup(
      <App
        data={dataWithShell({
          title: "T",
          links: [],
          pages: [
            { id: "overview", title: { en: "Overview", "zh-CN": "总览" } },
            { id: "exam", title: { en: "Exam", "zh-CN": "成绩单" } },
          ],
          initialPageId: "overview",
        })}
        reportPages={{
          overview: { en: "<p>A</p>", "zh-CN": "<p>A</p>" },
          exam: { en: "<p>B</p>", "zh-CN": "<p>B</p>" },
        }}
      />,
    );
    const triggers = html.match(/role="tab"/g) ?? [];
    expect(triggers).toHaveLength(2); // 恰为声明的两页,无宿主追加项
    expect(html.indexOf("Overview")).toBeLessThan(html.indexOf("Exam")); // 声明序
    expect(html).not.toContain("#/attempts");
    expect(html).not.toContain("#/traces");
  });

  it("裸 view(内建报告三页声明)导航恰为 报告 · Attempts · 追踪,来自页列表而非宿主", () => {
    const html = renderToStaticMarkup(
      <App
        data={dataWithShell({
          title: { en: "Eval Results", "zh-CN": "Eval 运行结果" },
          links: [],
          pages: [
            { id: "report", title: { en: "Report", "zh-CN": "报告" } },
            { id: "attempts", title: "Attempts" },
            { id: "traces", title: { en: "Traces", "zh-CN": "追踪" } },
          ],
          initialPageId: "report",
        })}
        reportPages={reportPages}
      />,
    );
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    for (const label of ["Report", "Attempts", "Traces"]) expect(html).toContain(label);
  });

  it("树形态定义(单页 report)导航只有一项", () => {
    const html = renderToStaticMarkup(
      <App
        data={dataWithShell({
          title: "T",
          links: [],
          pages: [{ id: "report", title: { en: "Report", "zh-CN": "报告" } }],
          initialPageId: "report",
        })}
        reportPages={{ report: reportPages.report }}
      />,
    );
    expect(html.match(/role="tab"/g)).toHaveLength(1);
  });

  it("ReportLink.icon 的内联 SVG 渲染在 label 前,原样内联", () => {
    const html = renderToStaticMarkup(
      <App
        data={dataWithShell({
          title: "T",
          links: [{ label: "GitHub", href: "https://example.com", icon: { svg: '<svg data-mark="gh"></svg>' } }],
          pages: [{ id: "report", title: "Report" }],
          initialPageId: "report",
        })}
        reportPages={reportPages}
      />,
    );
    const link = html.match(/<a[^>]*href="https:\/\/example\.com"[\s\S]*?<\/a>/)![0];
    const iconAt = link.indexOf('<svg data-mark="gh"></svg>');
    const labelAt = link.indexOf("GitHub");
    expect(iconAt).toBeGreaterThan(-1);
    expect(labelAt).toBeGreaterThan(iconAt);
  });
});
