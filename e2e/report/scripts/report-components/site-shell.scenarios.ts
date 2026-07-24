/// <reference lib="dom" />

import assert from "node:assert/strict";
import { sh } from "../sh.ts";
import {
  BRANDED_REPORT,
  SITE_REPORT,
  shRaw,
  type ReportComponentScenario,
} from "./harness.ts";

export const siteShellScenarios: readonly ReportComponentScenario[] = [
  {
    name: "Report shell · extends 保留页索引",
    // 场景：用户用 extends: standard 添加外壳。
    // Given：branded.tsx 只声明品牌字段，不重写 standard pages。
    // When：用户从 CLI 打开首页和 Attempts 页。
    // Then：两页都列出其它可导航页，且不把当前页重复列入。
    async run({ evidence }) {
      const root = evidence.resultsRoot;
      const bare = sh(`pnpm exec niceeval show --report ${BRANDED_REPORT} --results ${root}`);
      assert.ok(bare.includes(`niceeval show --results ${root} --report ${BRANDED_REPORT} --page attempts`));
      assert.ok(bare.includes(`niceeval show --results ${root} --report ${BRANDED_REPORT} --page traces`));
      assert.ok(!/--page report\b/.test(bare), "首页索引不应重复列出当前 report 页");

      const attempts = sh(`pnpm exec niceeval show --report ${BRANDED_REPORT} --results ${root} --page attempts`);
      assert.ok(attempts.includes(`niceeval show --results ${root} --report ${BRANDED_REPORT} --page report`));
      assert.ok(attempts.includes(`niceeval show --results ${root} --report ${BRANDED_REPORT} --page traces`));
    },
  },
  {
    name: "Report shell · 未知页面给出公开候选",
    // 场景：用户输错自定义报告的 page id。
    // Given：site.tsx 有三张导航页和一张 navigation:false 的 attempt page。
    // When：用户执行 --page bogus。
    // Then：命令失败且只列公开导航页，不泄漏隐藏的 review page。
    async run({ evidence }) {
      const bad = shRaw(`pnpm exec niceeval show --report ${SITE_REPORT} --results ${evidence.resultsRoot} --page bogus`);
      assert.notEqual(bad.status, 0, "--page bogus 应失败");
      assert.ok(
        bad.combined.includes("Available pages: overview, scoreboard, attempts"),
        `错误应只列公开导航页；got:\n${bad.combined}`,
      );
      assert.ok(!bad.combined.includes("review"), "隐藏的 attempt-input page 不应出现在候选列表");
    },
  },
  {
    name: "Report shell · 浏览器标题使用报告标题",
    // 场景：用户给报告声明品牌标题。
    // Given：branded.tsx 声明 title。
    // When：浏览器打开导出的 index.html。
    // Then：浏览器标题使用该公开字段。
    async run({ browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        assert.equal(await page.title(), "Results E2E · Branded");
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "Report shell · extends 保留浏览器导航",
    // 场景：用户只给 standard 报告叠加品牌外壳。
    // Given：branded.tsx 没有重写 pages。
    // When：浏览器渲染顶部导航。
    // Then：三张继承页面按原顺序可见。
    async run({ browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        const topbar = page.locator("header.topbar");
        await topbar.waitFor({ state: "visible", timeout: 10_000 });
        assert.deepEqual(await topbar.getByRole("tab").allTextContents(), ["Report", "Attempts", "Traces"]);
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "Report shell · 外链图标位于标签前",
    // 场景：报告作者给外链配置内联图标。
    // Given：branded.tsx 声明一条 GitHub ReportLink。
    // When：浏览器渲染外链。
    // Then：链接指向声明地址，图标出现在标签前。
    async run({ browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        const link = page.locator(".shell-links a").first();
        assert.equal(await page.locator(".shell-links a").count(), 1);
        assert.equal(await link.getAttribute("href"), "https://github.com/niceeval/niceeval");
        const linkHtml = await link.innerHTML();
        const iconAt = linkHtml.indexOf("<svg");
        const labelAt = linkHtml.indexOf("GitHub");
        assert.ok(iconAt >= 0 && labelAt > iconAt, "图标应位于 GitHub label 前");
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "Report shell · 浏览器呈现 footer",
    // 场景：报告作者声明 footer 文案。
    // Given：branded.tsx 配置 extends: standard 文案。
    // When：浏览器渲染页面底部。
    // Then：用户能看到该文案。
    async run({ browser, brandedBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${brandedBaseUrl}/index.html`, { waitUntil: "networkidle" });
        assert.match((await page.locator(".site-footer .site-footer-text").textContent()) ?? "", /extends: standard/);
      } finally {
        await page.close();
      }
    },
  },
  {
    name: "Report shell · 自定义多页按声明顺序导航",
    // 场景：用户定义三张自定义导航页。
    // Given：site.tsx 的 review page 明确 navigation:false。
    // When：浏览器水合顶部导航。
    // Then：只出现 Overview、Scoreboard、Attempts，顺序与报告声明一致。
    async run({ browser, siteBaseUrl }) {
      const page = await browser.newPage();
      try {
        await page.goto(`${siteBaseUrl}/index.html`, { waitUntil: "networkidle" });
        const topbar = page.locator("header.topbar");
        await topbar.waitFor({ state: "visible", timeout: 10_000 });
        assert.deepEqual(await topbar.getByRole("tab").allTextContents(), ["Overview", "Scoreboard", "Attempts"]);
      } finally {
        await page.close();
      }
    },
  },
];
