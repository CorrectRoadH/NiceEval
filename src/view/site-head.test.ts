// cases: docs/engineering/unit-tests/reports/cases.md
// 覆盖登记行:head 通道注入面——声明序注入 <head>、外链原样透传不进 assets/、
// 本地 src/href 物化为 assets/<sha256><ext>、attrs 渲染与转义、注入不改初始 HTML
// 数据节点、head 不进 ctx.report / viewData。
// 站点管线是 server 与 --out 的唯一联系面,断言全部打在 planSite 产物上。

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadViewScan } from "./data.ts";
import { planSite, readSiteFile, writeSite } from "./site.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../types.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-sitehead-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/** 最小结果根:单实验单快照单 attempt(与 view-report.test.ts 的 writeSnapshot 同一姿势)。 */
async function seedRoot(): Promise<string> {
  const root = await makeRoot();
  const dir = join(root, "compare_bub", "2026-07-08T10-00-00-000Z");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "snapshot.json"),
    JSON.stringify({
      format: RESULTS_FORMAT,
      schemaVersion: RESULTS_SCHEMA_VERSION,
      producer: { name: "niceeval", version: "0.4.6" },
      experimentId: "compare/bub",
      agent: "bub",
      startedAt: "2026-07-08T10:00:00.000Z",
      completedAt: "2026-07-08T10:00:00.000Z",
    }),
    "utf-8",
  );
  const attemptDir = join(dir, "weather/brooklyn", "a0");
  await mkdir(attemptDir, { recursive: true });
  await writeFile(
    join(attemptDir, "result.json"),
    JSON.stringify({ id: "weather/brooklyn", verdict: "passed", attempt: 0, durationMs: 1000, assertions: [] }),
    "utf-8",
  );
  return root;
}

const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>';

const GA_SRC = "https://www.googletagmanager.com/gtag/js?id=G-TEST";
const OG_IMAGE = 'https://x.example/a"b.png';

/** 不经包入口也合法的最小外壳报告(与 view-report.test.ts 的 shellReportSource 同一姿势)。 */
function headReportSource(head: string): string {
  return [
    'const FACES = Symbol.for("niceeval.report.faces");',
    'const DEFINITION = Symbol.for("niceeval.report.definition");',
    "const Block = (props) => Block[FACES].web(props);",
    "Block[FACES] = {",
    '  web: () => "HEAD_TEST_BODY",',
    '  text: () => "HEAD_TEST_BODY",',
    "};",
    "const definition = {",
    '  kind: "report",',
    '  title: "Head Test",',
    "  links: [],",
    `  head: ${head},`,
    "  scripts: [],",
    "  styles: [],",
    '  pages: [{ id: "report", title: "Report", content: { $$typeof: Symbol.for("react.transitional.element"), type: Block, props: {}, key: null } }],',
    "};",
    "Object.defineProperty(definition, DEFINITION, { value: true });",
    "export default definition;",
    "",
  ].join("\n");
}

const HEAD_DECL = JSON.stringify([
  { tag: "script", attrs: { async: true, src: GA_SRC } },
  { tag: "script", children: "window.dataLayer = window.dataLayer || [];" },
  { tag: "meta", attrs: { property: "og:image", content: OG_IMAGE } },
  { tag: "link", attrs: { rel: "icon", href: "./favicon.svg" } },
]);

async function seedReport(root: string, head: string): Promise<string> {
  const path = join(root, "head-report.mjs");
  await writeFile(path, headReportSource(head), "utf-8");
  await writeFile(join(root, "favicon.svg"), FAVICON_SVG, "utf-8");
  return path;
}

describe("站点管线 · head 通道注入", () => {
  it("按声明序注入 <head>:外链原样、布尔属性裸渲染、属性值转义、children 原样", async () => {
    const root = await seedRoot();
    const path = await seedReport(root, HEAD_DECL);
    const plan = await planSite(root, { report: { path, cwd: root } });
    const html = (await readSiteFile(plan.files.get("index.html")!)) as string;

    const gtag = `<script async src="${GA_SRC}"></script>`;
    const inline = "<script>window.dataLayer = window.dataLayer || [];</script>";
    const og = '<meta property="og:image" content="https://x.example/a&quot;b.png">';
    expect(html).toContain(gtag);
    expect(html).toContain(inline);
    expect(html).toContain(og);
    // 全部落在 <head> 内、按声明序。
    const headEnd = html.indexOf("</head>");
    const positions = [html.indexOf(gtag), html.indexOf(inline), html.indexOf(og), html.indexOf('rel="icon"')];
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    for (const p of positions) expect(p).toBeLessThan(headEnd);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("本地 href 物化为 assets/<sha256><ext> 并回填标签;外链不进 assets/;写盘与 server 读取同源", async () => {
    const root = await seedRoot();
    const path = await seedReport(root, HEAD_DECL);
    const plan = await planSite(root, { report: { path, cwd: root } });

    const sha256 = createHash("sha256").update(FAVICON_SVG).digest("hex");
    const assetPath = `assets/${sha256}.svg`;
    const html = (await readSiteFile(plan.files.get("index.html")!)) as string;
    expect(html).toContain(`<link rel="icon" href="${assetPath}">`);

    const assetKeys = [...plan.files.keys()].filter((p) => p.startsWith("assets/"));
    expect(assetKeys).toEqual([assetPath]); // 外链(gtag)不 vendored
    expect(plan.files.get(assetPath)!.contentType).toBe("image/svg+xml");
    // server 面:原字节读取(二进制安全)。
    const served = await readSiteFile(plan.files.get(assetPath)!);
    expect(Buffer.isBuffer(served)).toBe(true);
    expect((served as Buffer).toString("utf-8")).toBe(FAVICON_SVG);
    // 导出面:writeSite 落盘同一份字节。
    const out = join(root, "out");
    await writeSite(plan, out);
    expect(await readFile(join(out, assetPath), "utf-8")).toBe(FAVICON_SVG);
  });

  it("head 注入不改初始 HTML 的报告数据节点;head 不进 viewData.report", async () => {
    const root = await seedRoot();
    const withHead = await seedReport(root, HEAD_DECL);
    const planWith = await planSite(root, { report: { path: withHead, cwd: root } });

    const bare = join(root, "bare-report.mjs");
    await writeFile(bare, headReportSource("[]"), "utf-8");
    const planWithout = await planSite(root, { report: { path: bare, cwd: root } });

    const extractTemplate = (html: string): string => {
      const match = html.match(/<template id="niceeval-report-report-en">[\s\S]*?<\/template>/);
      expect(match).not.toBeNull();
      return match![0];
    };
    const htmlWith = (await readSiteFile(planWith.files.get("index.html")!)) as string;
    const htmlWithout = (await readSiteFile(planWithout.files.get("index.html")!)) as string;
    expect(extractTemplate(htmlWith)).toBe(extractTemplate(htmlWithout));

    // head 是注入资产,不进序列化声明(viewData.report)。
    const scan = await loadViewScan(root, { report: { path: withHead, cwd: root } });
    expect(scan.viewData.report).not.toHaveProperty("head");
    expect(scan.shellAssets.head).toHaveLength(4);
  });

  it("本地 href 缺失文件:装载报错并给出解析后的绝对路径", async () => {
    const root = await seedRoot();
    const path = join(root, "missing-asset.mjs");
    await writeFile(
      path,
      headReportSource(JSON.stringify([{ tag: "link", attrs: { rel: "icon", href: "./nope.svg" } }])),
      "utf-8",
    );
    await expect(planSite(root, { report: { path, cwd: root } })).rejects.toThrow(/asset not found: .*nope\.svg/);
  });
});
