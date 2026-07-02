// CLI 侧 i18n:内核(插值/归一)在 core.ts;这里只注入 env 来源与 zh-CN 默认值。

import { en } from "./en.ts";
import { zhCN, type MessageKey, type Messages } from "./zh-CN.ts";
import { interpolate, normalizeLocale, type Locale, type Vars } from "./core.ts";

export type { Locale, Vars } from "./core.ts";

const dictionaries: Record<Locale, Messages> = {
  "zh-CN": zhCN,
  en,
};

export function detectLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  return (
    normalizeLocale(env.NICEEVAL_LANG) ??
    normalizeLocale(env.NICEEVAL_LOCALE) ??
    normalizeLocale(env.LC_ALL) ??
    normalizeLocale(env.LC_MESSAGES) ??
    normalizeLocale(env.LANG) ??
    "zh-CN"
  );
}

export function t(key: MessageKey, vars: Vars = {}): string {
  return interpolate(dictionaries[detectLocale()][key], vars);
}
