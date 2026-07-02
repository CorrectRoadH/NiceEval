// 本地结果查看器入口:只做编排与对外导出。
// 读取/版本判定在 loader.ts,聚合在 aggregate.ts,HTTP 与 HTML 烘焙在 server.ts,
// server/前端共用的折叠口径、格式化与数据形状在 shared/。

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadSummaries } from "./loader.ts";
import { renderHtml, type ViewOptions } from "./server.ts";

export { startViewServer, type ViewOptions, type ViewServer } from "./server.ts";
export {
  IncompatibleResultsError,
  incompatibleHint,
  incompatibleViewCommand,
  loadMostRecentResults,
  loadSummaries,
  type IncompatibleRun,
  type ScanResult,
  type SkippedRun,
} from "./loader.ts";

/** 导出静态 HTML 报告(--out):一次性把当前结果烘焙进单个可分享文件。 */
export async function buildView(opts: ViewOptions = {}): Promise<string> {
  const scan = await loadSummaries(opts.input);
  const out = resolve(opts.out ?? ".niceeval/report.html");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await renderHtml(scan), "utf-8");
  return out;
}
