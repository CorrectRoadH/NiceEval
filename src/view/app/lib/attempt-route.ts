// attempt 级 hash 深链:`#/attempt/<run>/<result>`(docs/view.md「用 Reports 积木重建 view」)。
// 路由参数就是 AttemptRef(run 目录名 + summary.results 下标),由 loader 注入到每条 result 上;
// 这里只做纯解析 / 格式化 / 匹配,不碰 location / history,方便单测。
// hash 目前只有这一种路由:tab 切换是纯组件 state,旧版 modal 深链走 ?modal= 查询参数,互不占用。

import type { AttemptRef, ViewResult, ViewRow } from "../types.ts";

export const ATTEMPT_HASH_PREFIX = "#/attempt/";

/** AttemptRef → 可分享的 hash。run 整体编码(嵌套 run 目录里的 "/" 也编进去),下标恒为末段。 */
export function formatAttemptHash(ref: AttemptRef): string {
  return `${ATTEMPT_HASH_PREFIX}${encodeURIComponent(ref.run)}/${ref.result}`;
}

/**
 * hash → AttemptRef;不是本路由 / 形状不对返回 null(由调用方决定 warn 与否)。
 * 手写链接可能不编码 run 里的 "/"(嵌套 run 目录),所以按「最后一段是下标」切,而不是按段数。
 */
export function parseAttemptHash(hash: string): AttemptRef | null {
  if (!hash.startsWith(ATTEMPT_HASH_PREFIX)) return null;
  const rest = hash.slice(ATTEMPT_HASH_PREFIX.length);
  const cut = rest.lastIndexOf("/");
  if (cut <= 0) return null; // 没有下标段,或 run 为空
  const indexPart = rest.slice(cut + 1);
  if (!/^\d+$/.test(indexPart)) return null;
  let run: string;
  try {
    run = decodeURIComponent(rest.slice(0, cut));
  } catch {
    return null; // 非法 % 转义
  }
  if (!run) return null;
  return { run, result: parseInt(indexPart, 10) };
}

/** 在榜单行里找 AttemptRef 指向的 attempt;旧格式烘焙的数据没有 attemptRef,自然找不到。 */
export function resolveAttemptRef(rows: ViewRow[], ref: AttemptRef): ViewResult | null {
  for (const row of rows) {
    for (const result of row.results ?? []) {
      if (result.attemptRef?.run === ref.run && result.attemptRef.result === ref.result) return result;
    }
  }
  return null;
}

/** 深链定位不到时的提示(console.warn 用,英文);页面照常渲染,不开空 modal。 */
export function unresolvedAttemptWarning(hash: string): string {
  return (
    `[niceeval view] Ignoring attempt link "${hash}": no matching attempt in this view ` +
    `(run not loaded, result index out of range, or the data was baked without attempt refs).`
  );
}
