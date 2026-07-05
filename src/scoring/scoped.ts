// 作用域断言:读标准事件流的派生事实(toolCalls / parked …)、diff、脚本结果。
// 每个 builder 产一个延迟 Spec,context 负责 record。规则覆盖不到的奇怪断言可直接落 events。

import type { Spec } from "./collector.ts";
import type { DiffData, ScoringContext, StreamEvent, SubagentCall, SubagentMatch, ToolCall, ToolMatch } from "../types.ts";

// ── 工具匹配小语言 ──

function valueMatches(actual: unknown, expected: unknown, fullInput: unknown): boolean {
  if (expected instanceof RegExp) {
    if (typeof actual === "string" && expected.test(actual)) return true;
    // 逃生:对整个 input 的序列化串再试一次(路径可能藏在 command 里)
    try {
      return expected.test(JSON.stringify(fullInput));
    } catch {
      return false;
    }
  }
  if (typeof expected === "function") {
    return Boolean((expected as (v: unknown) => unknown)(actual));
  }
  if (expected !== null && typeof expected === "object") {
    return deepPartial(actual, expected);
  }
  return actual === expected;
}

function deepPartial(actual: unknown, expected: unknown): boolean {
  if (expected instanceof RegExp) return valueMatches(actual, expected, actual);
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") return false;
    for (const [k, v] of Object.entries(expected)) {
      if (!valueMatches((actual as Record<string, unknown>)[k], v, actual)) return false;
    }
    return true;
  }
  return actual === expected;
}

function toolMatches(tc: ToolCall, name: string, match?: ToolMatch): boolean {
  if (tc.name !== name && tc.originalName !== name) return false;
  if (match?.status && tc.status !== match.status) return false;
  if (match?.input) {
    for (const [k, expected] of Object.entries(match.input)) {
      const actual = (tc.input as Record<string, unknown> | null | undefined)?.[k];
      if (!valueMatches(actual, expected, tc.input)) return false;
    }
  }
  return true;
}

// ── evidence:把调用的出入参带回断言结果,view 展开可见,不用翻原始事件流 ──

function briefJson(value: unknown, max = 800): string {
  let s: string;
  try {
    s = JSON.stringify(value) ?? String(value);
  } catch {
    s = String(value);
  }
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function describeCalls(calls: readonly ToolCall[]): string | undefined {
  if (calls.length === 0) return undefined;
  return calls
    .map((tc) => {
      const name = tc.originalName && tc.originalName !== tc.name ? tc.originalName : tc.name;
      const lines = [`${name} [${tc.status}]`, `  input: ${briefJson(tc.input)}`];
      if (tc.output !== undefined) lines.push(`  output: ${briefJson(tc.output)}`);
      return lines.join("\n");
    })
    .join("\n");
}

function describeSubagents(calls: readonly SubagentCall[]): string | undefined {
  if (calls.length === 0) return undefined;
  return calls
    .map((s) => {
      const lines = [`${s.name} [${s.status}]${s.remoteUrl ? ` ${s.remoteUrl}` : ""}`];
      if (s.output !== undefined) lines.push(`  output: ${briefJson(s.output)}`);
      return lines.join("\n");
    })
    .join("\n");
}

function subagentMatches(call: SubagentCall, name: string, match?: SubagentMatch): boolean {
  if (call.name !== name) return false;
  if (match?.status && call.status !== match.status) return false;
  if (match?.remoteUrl !== undefined) {
    const actual = call.remoteUrl ?? "";
    const expected = match.remoteUrl;
    if (expected instanceof RegExp ? !expected.test(actual) : actual !== expected) return false;
  }
  return true;
}

// ── builders ──

export function succeeded(): Spec {
  return {
    name: "succeeded",
    severity: "gate",
    evaluate: (ctx) => (ctx.status !== "failed" && !ctx.facts.parked ? 1 : 0),
  };
}

export function parked(): Spec {
  return { name: "parked", severity: "gate", evaluate: (ctx) => (ctx.facts.parked ? 1 : 0) };
}

export function messageIncludes(token: string | RegExp): Spec {
  return {
    name: `messageIncludes(${token})`,
    severity: "gate",
    evaluate: (ctx) => {
      // 只看助手回复——事件流现在也含用户消息(send 内容),扫它会误判。
      const text = ctx.events
        .filter((e): e is Extract<typeof e, { type: "message" }> => e.type === "message" && e.role === "assistant")
        .map((e) => e.text)
        .join("\n");
      const ok = token instanceof RegExp ? token.test(text) : text.includes(token);
      // 失败时把实际被扫的助手文本带回来(和 t.check 的口径一致);命中时行色已说明一切。
      return ok ? 1 : { score: 0, evidence: text ? (text.length > 4000 ? text.slice(0, 4000) + "…" : text) : undefined };
    },
  };
}

export function calledTool(name: string, match?: ToolMatch): Spec {
  return {
    name: `calledTool(${name})`,
    severity: "gate",
    evaluate: (ctx) => {
      const matched = ctx.facts.toolCalls.filter((tc) => toolMatches(tc, name, match));
      const n = matched.length;
      const score = match?.count !== undefined ? (n === match.count ? 1 : 0) : n >= 1 ? 1 : 0;
      // 命中给命中调用的出入参;没命中给同名调用(条件不满足的近失);再没有就列出实际调过的工具。
      const sameName = ctx.facts.toolCalls.filter((tc) => tc.name === name || tc.originalName === name);
      const shown = matched.length ? matched : sameName.length ? sameName : ctx.facts.toolCalls;
      return { score, evidence: describeCalls(shown) };
    },
  };
}

export function notCalledTool(name: string, match?: ToolMatch): Spec {
  return {
    name: `notCalledTool(${name})`,
    severity: "gate",
    evaluate: (ctx) => {
      const matched = ctx.facts.toolCalls.filter((tc) => toolMatches(tc, name, match));
      return { score: matched.length === 0 ? 1 : 0, evidence: describeCalls(matched) };
    },
  };
}

export function toolOrder(names: string[]): Spec {
  return {
    name: `toolOrder(${names.join("→")})`,
    severity: "gate",
    evaluate: (ctx) => {
      let i = 0;
      for (const tc of ctx.facts.toolCalls) {
        if (i < names.length && (tc.name === names[i] || tc.originalName === names[i])) i++;
      }
      const actual = ctx.facts.toolCalls.map((tc) => tc.originalName ?? tc.name).join(" → ");
      return { score: i === names.length ? 1 : 0, evidence: actual || undefined };
    },
  };
}

export function usedNoTools(): Spec {
  return {
    name: "usedNoTools",
    severity: "gate",
    evaluate: (ctx) => ({
      score: ctx.facts.toolCalls.length === 0 ? 1 : 0,
      evidence: describeCalls(ctx.facts.toolCalls),
    }),
  };
}

export function maxToolCalls(max: number): Spec {
  return {
    name: `maxToolCalls(${max})`,
    severity: "gate",
    evaluate: (ctx) => ({
      score: ctx.facts.toolCalls.length <= max ? 1 : 0,
      evidence: describeCalls(ctx.facts.toolCalls),
    }),
  };
}

export function loadedSkill(skill: string): Spec {
  return calledTool("load_skill", { input: { skill } });
}

export function noFailedActions(): Spec {
  return {
    name: "noFailedActions",
    severity: "gate",
    evaluate: (ctx) => {
      const failedTools = ctx.facts.toolCalls.filter((tc) => tc.status === "failed");
      const failedSubs = ctx.facts.subagentCalls.filter((s) => s.status === "failed");
      const evidence = [describeCalls(failedTools), describeSubagents(failedSubs)].filter(Boolean).join("\n") || undefined;
      return { score: failedTools.length || failedSubs.length ? 0 : 1, evidence };
    },
  };
}

export function calledSubagent(name: string, match?: SubagentMatch): Spec {
  return {
    name: `calledSubagent(${name})`,
    severity: "gate",
    evaluate: (ctx) => {
      const matched = ctx.facts.subagentCalls.filter((call) => subagentMatches(call, name, match));
      const n = matched.length;
      const score = match?.count !== undefined ? (n === match.count ? 1 : 0) : n >= 1 ? 1 : 0;
      return { score, evidence: describeSubagents(matched.length ? matched : ctx.facts.subagentCalls) };
    },
  };
}

export function eventOfType(type: string, opts?: { count?: number }): Spec {
  return {
    name: `event(${type})`,
    severity: "gate",
    evaluate: (ctx) => {
      const n = ctx.events.filter((e) => e.type === type).length;
      if (opts?.count !== undefined) return n === opts.count ? 1 : 0;
      return n >= 1 ? 1 : 0;
    },
  };
}

export function notEventOfType(type: string): Spec {
  return {
    name: `notEvent(${type})`,
    severity: "gate",
    evaluate: (ctx) => (ctx.events.some((e) => e.type === type) ? 0 : 1),
  };
}

export function eventOrder(types: StreamEvent["type"][]): Spec {
  return {
    name: `eventOrder(${types.join("→")})`,
    severity: "gate",
    evaluate: (ctx) => {
      let i = 0;
      for (const ev of ctx.events) {
        if (i < types.length && ev.type === types[i]) i++;
      }
      return i === types.length ? 1 : 0;
    },
  };
}

export function eventsSatisfy(
  predicate: (events: readonly StreamEvent[]) => boolean,
  label = "predicate",
): Spec {
  return {
    name: `eventsSatisfy(${label})`,
    severity: "gate",
    evaluate: (ctx) => (predicate(ctx.events) ? 1 : 0),
  };
}

// ── 工作区 / 沙箱 ──

function diffMatchesRe(diff: DiffData, re: RegExp): boolean {
  for (const [path, content] of Object.entries(diff.generatedFiles)) {
    if (re.test(path) || re.test(content)) return true;
  }
  for (const path of diff.deletedFiles) {
    if (re.test(path)) return true;
  }
  return false;
}

export function fileChanged(path: string): Spec {
  return {
    name: `fileChanged(${path})`,
    severity: "gate",
    evaluate: (ctx) => (ctx.diff.generatedFiles[path] !== undefined ? 1 : 0),
  };
}

export function fileDeleted(path: string): Spec {
  return {
    name: `fileDeleted(${path})`,
    severity: "gate",
    evaluate: (ctx) => (ctx.diff.deletedFiles.includes(path) ? 1 : 0),
  };
}

export function notInDiff(re: RegExp): Spec {
  return {
    name: `notInDiff(${re})`,
    severity: "gate",
    evaluate: (ctx) => (diffMatchesRe(ctx.diff, re) ? 0 : 1),
  };
}

export function noFailedShellCommands(): Spec {
  return {
    name: "noFailedShellCommands",
    severity: "gate",
    evaluate: (ctx) => {
      const failed = ctx.facts.toolCalls.filter((tc) => tc.name === "shell" && tc.status === "failed");
      return { score: failed.length ? 0 : 1, evidence: describeCalls(failed) };
    },
  };
}

// ── 效率 / 成本 ──

export function maxTokens(max: number): Spec {
  return {
    name: `maxTokens(${max})`,
    severity: "gate",
    evaluate: (ctx) => {
      const total = ctx.usage.inputTokens + ctx.usage.outputTokens;
      return total <= max ? 1 : 0;
    },
  };
}

export function maxCost(usd: number): Spec {
  return {
    name: `maxCost(${usd})`,
    severity: "gate",
    evaluate: (ctx) => {
      const cost = ctx.usage.costUSD ?? 0;
      return cost <= usd ? 1 : 0;
    },
  };
}
