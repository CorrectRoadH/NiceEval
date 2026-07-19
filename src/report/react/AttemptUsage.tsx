// AttemptUsage:token / cache token / 成本 / provider usage 明细。没有 usage 时零输出
// (docs/feature/reports/library/attempt-detail.md)。

import type { ReactElement } from "react";
import type { AttemptUsageData } from "../types.ts";
import { cx } from "./format.ts";

export function AttemptUsage({ data, className }: { data: AttemptUsageData | null; className?: string }): ReactElement | null {
  if (data === null) return null;
  const { usage } = data;
  const rows: [string, string][] = [
    ["input tokens", usage.inputTokens.toLocaleString()],
    ["output tokens", usage.outputTokens.toLocaleString()],
  ];
  if (usage.cacheReadTokens !== undefined) rows.push(["cache read", usage.cacheReadTokens.toLocaleString()]);
  if (usage.cacheWriteTokens !== undefined) rows.push(["cache write", usage.cacheWriteTokens.toLocaleString()]);
  if (usage.requests !== undefined) rows.push(["requests", String(usage.requests)]);
  if (data.costUSD !== null) rows.push(["cost", `$${data.costUSD.toFixed(4)}`]);
  return (
    <dl className={cx("nre", "nre-attempt-usage", className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="nre-attempt-usage-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
