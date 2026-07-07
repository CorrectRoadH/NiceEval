// 本地结果查看器入口:只做编排与对外导出。
// 读取/版本判定在 loader.ts,聚合在 aggregate.ts,HTTP 与 HTML 烘焙在 server.ts,
// server/前端共用的折叠口径、格式化与数据形状在 shared/。

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadSummaries, type ScanResult } from "./loader.ts";
import { renderHtml, type ViewOptions } from "./server.ts";

export { startViewServer, type ViewOptions, type ViewServer } from "./server.ts";
export {
  IncompatibleResultsError,
  incompatibleHint,
  incompatibleViewCommand,
  loadLatestResultsPerEval,
  loadSummaries,
  type IncompatibleRun,
  type ScanResult,
  type SkippedRun,
} from "./loader.ts";

/**
 * 导出静态报告(--out):只有目录式一种形态。写 <dir>/index.html,并把前端会 fetch 的工件
 * (sources.json / events.json / trace.json)复制到 <dir>/artifact/<base>/——与本地
 * server 的 /artifact/<rel> 路由同一布局,整个目录扔给任何静态托管即是完整体验。
 * 单文件(*.html)导出已移除:代码/transcript/trace 视图依赖工件文件,单文件注定残缺,
 * 存在本身就在诱导用户导出一份看不了证据的报告(docs/view.md「静态导出」)。
 */
export async function buildView(opts: ViewOptions = {}): Promise<string> {
  const out = resolve(opts.out ?? ".niceeval/site");
  if (/\.html?$/i.test(out)) {
    throw new Error(
      `--out expects a directory, got "${opts.out}". Single-file HTML export was removed: code, transcript and trace views need artifact files next to the page. Export a directory instead (e.g. --out site) and serve it with any static host.`,
    );
  }
  const scan = await loadSummaries(opts.input);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "index.html"), await renderHtml(scan), "utf-8");
  await copyFetchedArtifacts(scan, join(out, "artifact"));
  return out;
}

// 只复制前端会 fetch 的三类工件。diff.json / o11y.json 是运行侧产物,查看器从不读取,
// 且 diff 可达上百 MB,带进静态导出只会拖垮部署体积。
const FETCHED_ARTIFACTS = ["sources.json", "events.json", "trace.json"];

async function copyFetchedArtifacts(scan: ScanResult, artifactRoot: string): Promise<void> {
  for (const [base, srcDir] of scan.artifactDirs) {
    const destDir = join(artifactRoot, base);
    // 输入本身已经是导出布局(比如对着上次导出的目录重新生成 index.html)时不自拷。
    if (resolve(srcDir) === resolve(destDir)) continue;
    const files = FETCHED_ARTIFACTS.filter((name) => existsSync(join(srcDir, name)));
    if (!files.length) continue;
    await mkdir(destDir, { recursive: true });
    await Promise.all(files.map((name) => copyFile(join(srcDir, name), join(destDir, name))));
  }
}
