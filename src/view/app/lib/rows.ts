// viewData 快照明细 → attempt 深链解析的纯拼接,零聚合口径:统计与列表整体住在报告页的
// 静态 HTML 里(报告组件的官方计算函数),前端不拼任何榜单行。Attempts / Traces 是内建报告
// 的普通页(AttemptList / TraceWaterfall 组件),不再由前端平铺快照明细。

import type { ViewResult, ViewSnapshot } from "../types.ts";

/** 旧版 ?modal= 深链的只读回退:在全部快照里按 (eval id, experimentId, attempt) 定位。 */
export function resultFromUrl(snapshots: ViewSnapshot[]): ViewResult | null {
  const p = new URLSearchParams(location.search);
  const id = p.get("modal");
  if (!id) return null;
  const exp = p.get("exp");
  const attempt = parseInt(p.get("a") ?? "0", 10);
  for (const snapshot of snapshots) {
    for (const result of snapshot.results) {
      if (result.id === id && (!exp || result.experimentId === exp) && result.attempt === attempt) {
        return result;
      }
    }
  }
  return null;
}
