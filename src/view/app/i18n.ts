// view 前端 i18n:内核(插值/归一)在 src/i18n/core.ts;这里只注入
// localStorage + navigator 的 locale 来源与 en 默认值。字典与 CLI 侧分开维护。
// 词条只覆盖宿主机器(导航标签、attempt 详情弹窗):页面内容(hero、警告、列表、瀑布)
// 是报告组件,文案在 niceeval/report 的组件词典里(src/report/locale.ts)。

import { interpolate, normalizeLocale, type Locale, type Vars } from "../../i18n/core.ts";

export type MessageKey =
  | "nav.label"
  | "hero.title"
  | "status.pass"
  | "status.fail"
  | "status.error"
  | "status.skipped"
  | "action.close"
  | "action.copyPrompt"
  | "action.copied"
  | "trace.loading"
  | "trace.loadFailed"
  | "trace.timing"
  | "trace.noSpans"
  | "trace.total"
  | "trace.spans"
  | "trace.clickDetails"
  | "trace.enableHint"
  | "trace.enableHintLink"
  | "trace.enableHintUrl"
  | "transcript.noEvents"
  | "transcript.user"
  | "transcript.assistant"
  | "transcript.thinking"
  | "transcript.inputRequested"
  | "transcript.awaitingInput"
  | "transcript.contextCompacted"
  | "transcript.skillLoaded"
  | "transcript.rawEvent"
  | "transcript.running"
  | "transcript.input"
  | "transcript.output"
  | "transcript.empty"
  | "code.otherAssertions"
  | "code.noReply"
  | "code.reply"
  | "code.hide"
  | "code.checks"
  | "code.conversation"
  | "code.noSource"
  | "code.sourceUnavailable"
  | "attempt.timing"
  | "attempt.teardown"
  | "attempt.diagnostics"
  | "assert.pass"
  | "assert.fail"
  | "assert.passedCollapsed"
  | "assert.unavailable"
  | "assert.optional"
  | "assert.soft"
  | "assert.evidence";

type Dictionary = Record<MessageKey, string>;

const dictionaries: Record<Locale, Dictionary> = {
  en: {
    "nav.label": "Report",
    // 标题回退链终点的内置文案(shell.md:「Eval 运行结果 / Eval Results」);
    // 正常路径 server 侧已走完回退链,这里只兜旧数据 / 缺声明。
    "hero.title": "Eval Results",
    "status.pass": "pass",
    "status.fail": "fail",
    "status.error": "error",
    "status.skipped": "skipped",
    "action.close": "Close",
    "action.copyPrompt": "Copy fix prompt",
    "action.copied": "Copied",
    "trace.loading": "loading...",
    "trace.loadFailed": "load failed (static report has no server - use niceeval view):",
    "trace.timing": "timing trace",
    "trace.noSpans": "no spans",
    "trace.total": "total",
    "trace.spans": "spans",
    "trace.clickDetails": "click a row for details",
    "trace.enableHint": "No trace for this run. Wire up OTel to get a call waterfall — see the ",
    "trace.enableHintLink": "OTel guide",
    "trace.enableHintUrl": "https://niceeval.com/docs/guides/connect-otel",
    "transcript.noEvents": "no events",
    "transcript.user": "user",
    "transcript.assistant": "assistant",
    "transcript.thinking": "thinking",
    "transcript.inputRequested": "input requested",
    "transcript.awaitingInput": "(awaiting input)",
    "transcript.contextCompacted": "context compacted",
    "transcript.skillLoaded": "skill loaded",
    "transcript.rawEvent": "unrecognized event, shown as-is",
    "transcript.running": "running...",
    "transcript.input": "input",
    "transcript.output": "output",
    "transcript.empty": "(empty)",
    "code.otherAssertions": "other assertions",
    "code.noReply": "(no reply)",
    "code.reply": "reply",
    "code.hide": "hide",
    "code.checks": "checks",
    "code.conversation": "conversation",
    "code.noSource": "Source was not captured. This run may predate source-loc or the source may be unavailable. Re-run this eval to see the code view.",
    "code.sourceUnavailable": "Source was captured for this run, but its artifact files are missing from this deployment. Re-export with `niceeval view --out <dir>` (directory mode bundles artifacts), or open the results locally with `niceeval view`.",
    "attempt.timing": "timing",
    "attempt.teardown": "teardown (not counted in total)",
    "attempt.diagnostics": "diagnostics",
    "assert.pass": "pass",
    "assert.fail": "fail",
    "assert.passedCollapsed": "{{count}} passed",
    "assert.unavailable": "unavailable",
    "assert.optional": "optional",
    "assert.soft": "soft",
    "assert.evidence": "What was checked",
  },
  "zh-CN": {
    "nav.label": "报告",
    "hero.title": "Eval 运行结果",
    "status.pass": "通过",
    "status.fail": "失败",
    "status.error": "错误",
    "status.skipped": "跳过",
    "action.close": "关闭",
    "action.copyPrompt": "复制修复 Prompt",
    "action.copied": "已复制",
    "trace.loading": "加载中...",
    "trace.loadFailed": "加载失败(静态报告没有服务端 - 请用 niceeval view):",
    "trace.timing": "耗时追踪",
    "trace.noSpans": "没有 span",
    "trace.total": "总计",
    "trace.spans": "spans",
    "trace.clickDetails": "点击行查看详情",
    "trace.enableHint": "这次运行没有 trace。接入 OTel 才有调用瀑布图——看",
    "trace.enableHintLink": "OTel 接入指南",
    "trace.enableHintUrl": "https://niceeval.com/docs/zh/how-to/connect-otel",
    "transcript.noEvents": "没有事件",
    "transcript.user": "user",
    "transcript.assistant": "assistant",
    "transcript.thinking": "thinking",
    "transcript.inputRequested": "请求输入",
    "transcript.awaitingInput": "(等待输入)",
    "transcript.contextCompacted": "上下文已压缩",
    "transcript.skillLoaded": "已加载 Skill",
    "transcript.rawEvent": "未识别事件,原样展示",
    "transcript.running": "运行中...",
    "transcript.input": "输入",
    "transcript.output": "输出",
    "transcript.empty": "(空)",
    "code.otherAssertions": "其它断言",
    "code.noReply": "(无回复)",
    "code.reply": "回复",
    "code.hide": "收起",
    "code.checks": "检查",
    "code.conversation": "会话",
    "code.noSource": "源码未捕获。此 run 可能早于 source-loc，或源码不可读。重跑此 eval 即可看到代码视图。",
    "code.sourceUnavailable": "此 run 捕获过源码，但当前部署里缺少它的 artifact 文件。用 `niceeval view --out <目录>` 重新导出（目录模式会带上 artifact），或在本地 `niceeval view` 查看。",
    "attempt.timing": "耗时",
    "attempt.teardown": "收尾(不计入总耗时)",
    "attempt.diagnostics": "诊断",
    "assert.pass": "通过",
    "assert.fail": "失败",
    "assert.passedCollapsed": "{{count}} 条通过",
    "assert.unavailable": "评不了",
    "assert.optional": "可缺席",
    "assert.soft": "soft",
    "assert.evidence": "实际被检查的内容",
  },
};

const storageKey = "niceeval:view:locale";

export function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const candidates = typeof navigator === "undefined" ? [] : [navigator.language, ...(navigator.languages ?? [])];
  return candidates.some((value) => normalizeLocale(value) === "zh-CN") ? "zh-CN" : "en";
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(storageKey, locale);
  } catch {
    // Reports must still work from local files and locked-down browsers.
  }
}

// 浏览器 <title> 是宿主文档单例,唯一归属是 App 的 shellTitle effect(外壳标题回退链);
// 这里只切文档语言,不碰标题。
export function setDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
}

export function makeTranslator(locale: Locale): (key: MessageKey, vars?: Vars) => string {
  return (key, vars) => interpolate(dictionaries[locale][key], vars);
}

function readStoredLocale(): Locale | undefined {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "zh-CN" || value === "en" ? value : undefined;
  } catch {
    return undefined;
  }
}
