// 从一坨 OTLP span 里挑「语义」span:agent 真正做的事(回合 / 模型调用 / 工具调用),
// 丢掉每-chunk / 每-item 的内部 instrument span 与建表/配置类 plumbing。
//
// 为什么要挑:像 codex 这种 Rust agent 的 OTLP 把内部 tracing 全导出来了 —— 一个 eval 上万条
// span(handle_responses/receiving/append_items…),直接落盘会把 summary.json 撑到几十 MB、
// view 渲染几万行。挑完只剩百来条有意义的,瀑布图才读得动。
//
// 判定尽量按【语义信号】而非写死的 span 名(各 agent / 各版本名字会变):
//   · 工具执行 —— 带 tool_name 属性,或名字是执行/路由动词(exec/apply_patch/handle_tool_call…);
//   · 模型调用 —— 带 gen_ai.* 语义 / 到模型的 HTTP(wire_api / http.method+api.path),或采样/流式名;
//   · 回合骨架 —— 带 turn.id / codex.turn.*,或 codex.exec / run_turn / invoke_agent / agent.step 这类名。
// 同时:trace 本身就不大时(干净的 agent,如 bub 只有几十条)整段保留,不做任何过滤。

import type { TraceSpan } from "../../types.ts";

/** 不大的 trace 整段保留(没有 firehose 要对付)。 */
const SMALL_TRACE = 150;
/** 单个 span 名在一次运行里出现这么多次,视为每-chunk/每-item 内部噪声。 */
const FIREHOSE_FREQ = 80;
/** 语义过滤后仍超这个数,再按耗时硬截断兜底。 */
const HARD_CAP = 1000;

function isSemantic(sp: TraceSpan, freq: Record<string, number>): boolean {
  const ln = sp.name.toLowerCase();
  const a = sp.attributes ?? {};
  const keys = Object.keys(a);

  // 每-chunk / 每-item 高频内部 span:直接丢。
  if (freq[sp.name] > FIREHOSE_FREQ) return false;

  // 工具执行:带 tool_name 属性 = 真执行;或名字是执行/路由动词。
  if ("tool_name" in a) return true;
  if (/(^|[._])(exec_command|apply_patch|write_stdin|execute_tool|run_command|handle_tool_call|dispatch_tool_call)/.test(ln)) {
    return true;
  }

  // 模型调用:GenAI 语义属性 / 到模型的 HTTP / 采样·流式名。
  if (keys.some((k) => k.startsWith("gen_ai.request") || k.startsWith("gen_ai.response"))) return true;
  if ("wire_api" in a || ("http.method" in a && "api.path" in a)) return true;
  if (/(^|[._])(run_sampling_request|try_run_sampling_request|stream_responses|receiving_stream|model_client|chat|completion)(\b|_|$)/.test(ln)) {
    return true;
  }

  // 回合 / 会话骨架。
  if ("turn.id" in a || keys.some((k) => k.startsWith("codex.turn"))) return true;
  if (/^(codex\.exec|session_loop|run_turn|invoke_agent)$/.test(ln) || /session_task\.turn|agent\.step/.test(ln)) return true;

  return false;
}

/**
 * 选出要保留并落盘的 span。
 * 小 trace 原样返回;大 trace 走语义过滤;过滤后仍过多再按耗时降序硬截断(兜底)。
 * 最后一律按起点排序,view 直接当瀑布图渲染。
 */
export function selectTraceSpans(spans: TraceSpan[]): TraceSpan[] {
  if (spans.length <= SMALL_TRACE) return spans.slice().sort((a, b) => a.startMs - b.startMs);

  const freq: Record<string, number> = {};
  for (const sp of spans) freq[sp.name] = (freq[sp.name] ?? 0) + 1;

  let kept = spans.filter((sp) => isSemantic(sp, freq));
  // 语义过滤反而把什么都滤没了(陌生 agent 的命名约定不沾边)——退回原始,交给硬截断。
  if (kept.length === 0) kept = spans;

  if (kept.length > HARD_CAP) {
    kept = kept
      .slice()
      .sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
      .slice(0, HARD_CAP);
  }
  return kept.sort((a, b) => a.startMs - b.startMs);
}
