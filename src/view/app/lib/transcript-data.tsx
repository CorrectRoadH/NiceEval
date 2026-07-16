import type { ReactNode } from "react";
import type { Assertion, Indexed, IndexedTurns, SourceTurn, TranscriptEvent, ViewJson } from "../types.ts";
import type { ToolBlockCall } from "../shared.ts";
import { isObjectRecord } from "./guards.ts";
import { prettyJson } from "./format.ts";

// ───────────────────────── 源码对齐的代码视图(github-diff 式)─────────────────────────
// 拿 sources.json(eval 源码)+ events.json(带 loc 的 send),把每条 send / 断言的运行结果
// 叠回真实源码行:send 行折叠→展开看回复;断言行绿(过)/红(不过),judge 行带分数,展开看 CoT。

export function locKey(file: string, line: number): string {
  return `${file}:${line}`;
}

/** events → 按 send 的 loc 聚成「轮」:每轮含 sent 文本 + 后续 thinking/assistant/tool 回复。 */
export function indexTurns(events: TranscriptEvent[]): IndexedTurns {
  const byKey = new Map<string, SourceTurn>();
  const noloc: SourceTurn[] = [];
  // callId → tool 回复,跨轮共享:HITL(审批门)下 action.called 在 send 轮、
  // action.result 在 respond 轮才到,只在当轮找会把结果丢掉。
  const toolByCallId = new Map<string, Extract<SourceTurn["replies"][number], { kind: "tool" }>>();
  let cur: SourceTurn | null = null;
  for (const ev of events || []) {
    if (ev.type === "message" && ev.role === "user") {
      // 同一条 send 会在流里出现两次:runner 在 send 时记带 loc 的一条,agent 原生
      // transcript 又回显同文本、无 loc 的一条。无 loc 的 user 消息不开新轮——回显
      // (与当前轮 sent 同文本且回复还没开始)直接吃掉,其它(stop-hook 反馈、skill
      // 注入等轮内注入)作为回复条目留在当前轮;否则回复全被回显轮抢走,
      // 带 loc 的 send 行只剩「(无回复)」。
      if (!ev.loc && cur) {
        if (cur.replies.length === 0 && (ev.text || "") === cur.sent) continue;
        cur.replies.push({ kind: "user", text: ev.text || "" });
        continue;
      }
      cur = { loc: ev.loc, sent: ev.text || "", replies: [] };
      if (ev.loc) byKey.set(locKey(ev.loc.file, ev.loc.line), cur);
      else noloc.push(cur);
    } else if (!cur) {
      continue;
    } else if (ev.type === "message" && ev.role === "assistant") {
      cur.replies.push({ kind: "text", text: ev.text || "" });
    } else if (ev.type === "thinking") {
      cur.replies.push({ kind: "thinking", text: ev.text || "" });
    } else if (ev.type === "action.called") {
      const reply = { kind: "tool" as const, ev };
      toolByCallId.set(ev.callId, reply);
      cur.replies.push(reply);
    } else if (ev.type === "action.result") {
      const tool = toolByCallId.get(ev.callId);
      if (tool) tool.result = ev;
    } else if (ev.type === "skill.loaded") {
      cur.replies.push({ kind: "skill", skill: ev.skill });
    } else if (ev.type === "view.raw") {
      cur.replies.push({ kind: "raw", raw: ev.raw });
    } else if (ev.type === "input.requested") {
      cur.replies.push({ kind: "input", ev });
    } else if (ev.type === "error") {
      cur.replies.push({ kind: "error", text: ev.message || "error" });
    }
  }
  return { byKey, noloc };
}

/** assertions → 按 loc 聚到行。有 loc 的进 byKey,没 loc 的进 noloc(底部兜底列)。 */
export function indexAsserts(assertions: Assertion[]): Indexed<Assertion> {
  const byKey = new Map<string, Assertion[]>();
  const noloc: Assertion[] = [];
  for (const a of assertions || []) {
    if (a.loc) {
      const k = locKey(a.loc.file, a.loc.line);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)?.push(a);
    } else {
      noloc.push(a);
    }
  }
  return { byKey, noloc };
}

export const TS_HL_RE =
  /(\/\/[^\n]*)|(\/\*[^]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|default|const|let|var|async|await|function|return|if|else|for|of|in|new|class|extends|typeof|void|true|false|null|undefined)\b|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;

/** 轻量 TS 着色(逐行,零依赖):注释 / 字符串 / 关键字 / 数字 / 函数名。 */
export function highlightTs(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  TS_HL_RE.lastIndex = 0;
  while ((m = TS_HL_RE.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls = m[1] || m[2] ? "tok-comment" : m[3] ? "tok-str" : m[4] ? "tok-kw" : m[5] ? "tok-num" : m[6] ? "tok-fn" : null;
    out.push(cls ? <span key={i++} className={cls}>{m[0]}</span> : m[0]);
    last = m.index + m[0].length;
    if (m[0].length === 0) TS_HL_RE.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export const TOOL_VERB: Record<string, string> = {
  file_read: "Read",
  file_write: "Write",
  file_edit: "Edit",
  shell: "Bash",
  web_fetch: "Fetch",
  web_search: "Search",
  glob: "Glob",
  grep: "Grep",
  list_dir: "List",
  agent_task: "Task",
};

export function toolPrimaryArg(call: ToolBlockCall): string {
  const input = call.input;
  if (typeof input === "string") return input;
  if (!isObjectRecord(input)) return "";
  if (call.tool === "shell") {
    const command = input.command ?? input.cmd;
    if (typeof command === "string") return command;
    if (Array.isArray(command)) return command.filter((x: ViewJson) => typeof x === "string").join(" ");
  }
  for (const key of ["path", "file", "file_path", "filename", "pattern", "query", "url", "uri", "prompt", "description", "command", "remoteUrl"]) {
    const value = input[key];
    if (typeof value === "string" && value) return value;
  }
  // 领域工具(get_weather / calculate…)的入参 key 不在上面的通用名单里,
  // 兜底给紧凑 JSON——入参是断言的一等材料,不能因为 key 认不出就不显示。
  const keys = Object.keys(input);
  if (keys.length > 0) {
    try {
      const compact = JSON.stringify(input);
      return compact.length > 200 ? compact.slice(0, 200) + "…" : compact;
    } catch {
      return "";
    }
  }
  return "";
}

export function resultBody(output: ViewJson | undefined): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (isObjectRecord(output)) {
    for (const key of ["output", "stdout", "content", "text", "result", "body"]) {
      const value = output[key];
      if (typeof value === "string") return value;
    }
  }
  return prettyJson(output);
}
