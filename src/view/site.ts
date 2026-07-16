// 站点管线:本地 server 与 `--out` 的唯一联系面(docs/feature/reports/view.md 开篇)。
// planSite 把结果根物化成一份站点产物清单(index.html + artifact 证据树),writeSite 把清单
// 写盘,server 按路径服务同一份清单——布局与取数知识(artifact 相对路径、sources.json 解引用)
// 只住在这里,两个宿主都是哑消费者,同一路径两边逐字节一致(site-parity 测试守护)。

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadViewScan, type ViewScan, type ViewScanOptions } from "./data.ts";
import { localizeText } from "../show/report-host.ts";

/** 站点产物清单里的一个文件:现算内容,或指向结果根内的原文件。 */
export interface SiteFile {
  /** 站点相对路径(posix),如 `index.html`、`artifact/<base>/events.json`。 */
  path: string;
  contentType: string;
  source: { kind: "content"; body: string } | { kind: "file"; abs: string };
}

export interface SitePlan {
  /** path → SiteFile;写盘按它遍历,server 按它查表(查不到即 404,不存在旁路取数)。 */
  files: Map<string, SiteFile>;
  /** 构建这份产物用的扫描结果(publishState 等宿主前置校验用;不进产物)。 */
  scan: ViewScan;
}

const JSON_TYPE = "application/json; charset=utf-8";
const HTML_TYPE = "text/html; charset=utf-8";

// 前端会 fetch 的原字节证据文件(docs/feature/reports/view.md「静态导出」:有就带,缺时前端
// 在证据位置如实显示缺失;o11y.json 永不进产物——报告数字已烘进 HTML,浏览器不读它)。
const RAW_COPY_ARTIFACTS = ["events.json", "trace.json", "diff.json"];

/**
 * 把结果根物化成站点产物清单。sources.json 是唯一的格式例外——盘上是去重后的引用
 * (`{path, sha256}[]`),必须经 `AttemptHandle.sources()` 解引用出完整内容(`{path, content}[]`)
 * 才能给浏览器用,解引用只发生在这里这一处。
 */
export async function planSite(input?: string, opts: ViewScanOptions = {}): Promise<SitePlan> {
  const scan = await loadViewScan(input, opts);
  const files = new Map<string, SiteFile>();
  files.set("index.html", {
    path: "index.html",
    contentType: HTML_TYPE,
    source: { kind: "content", body: await renderHtml(scan) },
  });

  for (const [base, srcDir] of scan.artifactDirs) {
    for (const name of RAW_COPY_ARTIFACTS) {
      const abs = join(srcDir, name);
      if (!existsSync(abs)) continue;
      const path = `artifact/${base}/${name}`;
      files.set(path, { path, contentType: JSON_TYPE, source: { kind: "file", abs } });
    }
    if (existsSync(join(srcDir, "sources.json"))) {
      const attempt = scan.attemptsByBase.get(base);
      const sources = attempt ? await attempt.sources() : null;
      const path = `artifact/${base}/sources.json`;
      files.set(path, { path, contentType: JSON_TYPE, source: { kind: "content", body: JSON.stringify(sources ?? []) } });
    }
  }
  return { files, scan };
}

/** 把站点产物清单写盘(`--out`)。输入本身已是导出布局(对上次导出的目录重新生成)时原文件不自拷。 */
export async function writeSite(plan: SitePlan, outDir: string): Promise<void> {
  for (const file of plan.files.values()) {
    const dest = join(outDir, file.path);
    await mkdir(dirname(dest), { recursive: true });
    if (file.source.kind === "content") {
      await writeFile(dest, file.source.body, "utf-8");
    } else if (resolve(file.source.abs) !== resolve(dest)) {
      await copyFile(file.source.abs, dest);
    }
  }
}

/** 取清单中一个文件的字节(server 响应体与写盘内容同源;file 类缺失时返回 undefined,由宿主 404)。 */
export async function readSiteFile(file: SiteFile): Promise<string | undefined> {
  if (file.source.kind === "content") return file.source.body;
  try {
    return await readFile(file.source.abs, "utf-8");
  } catch {
    return undefined;
  }
}

const TEMPLATE_PLACEHOLDERS = {
  styles: "<!-- __NICEEVAL_STYLES__ -->",
  appCode: "__NICEEVAL_APP_CODE__",
  viewData: "__NICEEVAL_VIEW_DATA_JSON__",
  reportSlot: "<!-- __NICEEVAL_REPORT_SLOT__ -->",
} as const;

/**
 * 把 viewData(只含原始值与相对路径,不含宿主机绝对路径)和前端产物烘焙进单个 HTML。
 * 报告槽恒在:每页报告 HTML 作为 <template id="niceeval-report-<pageId>-<locale>"> 静态块
 * 烘在 __NICEEVAL_VIEW_DATA__ 旁(不 hydrate,自定义组件的 <Style> 产物已内联其中),
 * 并恒内联官方组件样式(report/react/styles.css)与渐进增强 runtime(report/react/enhance.js,
 * 内联 <script>:排序 / 过滤 / tooltip,document 级事件委托,报告块被前端搬进槽位也无需重绑;
 * 无 JS 时报告内容依旧完整);外壳声明的 styles 注入在官方样式之后、scripts 注入在官方
 * 增强脚本之后 </body> 前,均按声明顺序(docs/feature/reports/library/shell.md)。
 * 前端只把当前页 / 当前界面语言对应的块摆进报告槽位置,不解析。
 */
export async function renderHtml(scan: ViewScan): Promise<string> {
  const template = await readViewAsset("template.html");
  const styles = await readViewAsset("client-dist/app.css");
  const app = await readViewAsset("client-dist/app.js");
  const [reportStyles, reportEnhance] = await Promise.all([
    readFile(new URL("../report/react/styles.css", import.meta.url), "utf-8"),
    readFile(new URL("../report/react/enhance.js", import.meta.url), "utf-8"),
  ]);

  const shellStyles = scan.shellAssets.styles.map((css) => `\n<style>\n${css}\n</style>`).join("");
  const shellScripts = scan.shellAssets.scripts.map((js) => `<script>\n${js}\n</script>\n`).join("");

  const pageTemplates = scan.reportPages
    .flatMap((page) => [
      `<template id="niceeval-report-${page.id}-en">${page.html.en}</template>`,
      `<template id="niceeval-report-${page.id}-zh-CN">${page.html["zh-CN"]}</template>`,
    ])
    .join("\n");

  // 初始 <title> 与 hero 同源:走完回退链的报告标题(viewData.report.title;终点是内置文案
  // 「Eval 运行结果 / Eval Results」)。模板 lang="en",初始按 en 解析;前端按界面语言更新。
  const title = localizeText(scan.viewData.report?.title, "en") ?? "Eval Results";

  return template
    .replace(
      /<title>[^<]*<\/title>/,
      () => `<title>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>`,
    )
    .replace(
      TEMPLATE_PLACEHOLDERS.styles,
      () =>
        `<style>\n${styles}\n</style>\n<style>\n${reportStyles}\n</style>\n<script>\n${reportEnhance}\n</script>` +
        shellStyles,
    )
    .replace(TEMPLATE_PLACEHOLDERS.reportSlot, () => pageTemplates)
    .replace(TEMPLATE_PLACEHOLDERS.viewData, () => JSON.stringify(scan.viewData).replace(/</g, "\\u003c"))
    .replace(TEMPLATE_PLACEHOLDERS.appCode, () => JSON.stringify(app).replace(/</g, "\\u003c"))
    .replace("</body>", () => `${shellScripts}</body>`);
}

async function readViewAsset(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf-8");
}
