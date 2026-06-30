// 价格表兜底估算:agent 没带回网关实测成本时,用 token 用量 × vendored 单价估一个。
// 数据来自 src/o11y/prices.json(models.dev,见 scripts/sync-prices.ts);per-1M USD。
//
// 与 types.ts 的约定一致:usage.costUSD(实测)优先,这里只在缺实测时兜底,
// 查不到价就返回 undefined —— 显示 "—" 而不是骗人的 $0。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Usage } from "../types.ts";

interface Price {
  in: number;
  out: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const PRICES: Record<string, Price> = (() => {
  try {
    const raw = readFileSync(fileURLToPath(new URL("./prices.json", import.meta.url)), "utf-8");
    return (JSON.parse(raw) as { prices?: Record<string, Price> }).prices ?? {};
  } catch {
    return {};
  }
})();

/**
 * 把五花八门的 model 标识归一到价格表的 key:精确命中优先,再退而去掉 provider 前缀
 * (`anthropic/claude-…` → `claude-…`)和末尾日期版本(`…-4-5-20251001` → `…-4-5`)。
 */
function lookup(model: string): Price | undefined {
  if (PRICES[model]) return PRICES[model];
  const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  if (PRICES[bare]) return PRICES[bare];
  const undated = bare.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (PRICES[undated]) return PRICES[undated];
  return undefined;
}

/**
 * 按 token 桶 × 单价估算一次运行的美元成本。cache 桶缺专门单价时退回 input 价
 * (cache token 本质也是 input)。无 model / 查不到价 / 零用量 → undefined。
 */
export function estimateCost(model: string | undefined, usage: Usage): number | undefined {
  if (!model) return undefined;
  const p = lookup(model);
  if (!p) return undefined;
  const bucket = (tokens: number | undefined, price: number | undefined, fallback: number): number =>
    tokens ? tokens * (price ?? fallback) : 0;
  const usd =
    (bucket(usage.inputTokens, p.in, p.in) +
      bucket(usage.outputTokens, p.out, p.out) +
      bucket(usage.cacheReadTokens, p.cacheRead, p.in) +
      bucket(usage.cacheWriteTokens, p.cacheWrite, p.in)) /
    1e6;
  return usd > 0 ? usd : undefined;
}
