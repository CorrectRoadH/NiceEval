import type {
  ChatModelAdapter,
  ThreadAssistantMessagePart,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";

// 把 Codex SDK 原生 SSE 协议(见 server.ts)翻译成 assistant-ui 的
// ChatModelAdapter:agent_message → text part,reasoning → reasoning part,
// 其余 item → tool-call part。解析逻辑从旧的手写实现(itemToCell/readSseJson)
// 原样移植,UI 状态(消息列表/composer/停止)全部交给 assistant-ui。

// Codex 线程续接靠 thread_id(SDK 落盘在 ~/.codex/sessions):`thread.started`
// 事件里带,存在模块级变量里,下一轮请求带回去。
let threadId: string | undefined;

// 一轮 turn 的累积状态。同一 item.id 的 item.started / item.updated /
// item.completed 是三个阶段,按最新快照 upsert;Map 保留插入顺序,重放即渲染
// 顺序。errors 汇集 turn.failed / error 事件和 error item。
export type TurnState = {
  parts: Map<string, ThreadAssistantMessagePart>;
  errors: string[];
  threadId?: string;
};

export function createTurnState(): TurnState {
  return { parts: new Map(), errors: [] };
}

export function reduceEvent(state: TurnState, event: ThreadEvent): void {
  switch (event.type) {
    case "thread.started":
      state.threadId = event.thread_id;
      break;
    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = event.item;
      if (item.type === "error") {
        state.errors.push(item.message);
        break;
      }
      const part = itemToPart(item);
      if (part) state.parts.set(item.id, part);
      break;
    }
    case "turn.failed":
      state.errors.push(event.error.message);
      break;
    case "error":
      state.errors.push(event.message);
      break;
    default:
      break;
  }
}

// assistant-ui 要求每次 yield 全量累积的 content 数组(不是增量)。
export function contentOf(state: TurnState): ThreadAssistantMessagePart[] {
  return [...state.parts.values()];
}

function toolPart(
  id: string,
  toolName: string,
  args: unknown,
  result: unknown,
  isError: boolean,
): ToolCallMessagePart {
  return {
    type: "tool-call",
    toolCallId: id,
    toolName,
    args: args as ToolCallMessagePart["args"],
    argsText: JSON.stringify(args),
    ...(result !== undefined ? { result } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

export function itemToPart(item: ThreadItem): ThreadAssistantMessagePart | null {
  switch (item.type) {
    case "agent_message":
      // Codex 对 agent_message 没有 token 级增量,item.completed 一次给整段。
      return { type: "text", text: item.text };
    case "reasoning":
      return { type: "reasoning", text: item.text ?? "" };
    case "command_execution":
      return toolPart(
        item.id,
        item.type,
        { command: item.command },
        // exit_code 只在命令结束后才有;在那之前不给 result(= 还在跑)。
        item.exit_code != null
          ? { exit_code: item.exit_code, aggregated_output: item.aggregated_output }
          : undefined,
        item.status === "failed",
      );
    case "file_change":
      return toolPart(item.id, item.type, { changes: item.changes }, { status: item.status }, item.status === "failed");
    case "mcp_tool_call":
      return toolPart(
        item.id,
        `mcp:${item.server}.${item.tool}`,
        item.arguments ?? {},
        item.error ? { error: item.error.message } : item.result,
        Boolean(item.error),
      );
    case "web_search":
      return toolPart(item.id, item.type, { query: item.query }, undefined, false);
    case "todo_list":
      return toolPart(item.id, item.type, { items: item.items }, undefined, false);
    default:
      return null;
  }
}

// 工具气泡的单行摘要(`⚙ toolName → detail`),按 toolName 还原旧版
// itemToCell 里每种 item 的 detail 文案。
export function toolDetail(part: ToolCallMessagePart): string {
  const args = part.args as Record<string, unknown>;
  const result = part.result as Record<string, unknown> | undefined;
  if (part.toolName === "command_execution") {
    return `${args.command}${result?.exit_code != null ? ` (exit ${result.exit_code})` : ""}`;
  }
  if (part.toolName === "file_change") {
    const changes = args.changes as Array<{ kind: string; path: string }>;
    return changes.map((c) => `${c.kind} ${c.path}`).join(", ");
  }
  if (part.toolName.startsWith("mcp:")) {
    return part.isError ? String(result?.error ?? "") : JSON.stringify(args);
  }
  if (part.toolName === "todo_list") {
    const items = args.items as Array<{ text: string; completed: boolean }>;
    return items.map((t) => `${t.completed ? "✔" : "○"} ${t.text}`).join(" / ");
  }
  // web_search 等:直接展示输入参数。
  return JSON.stringify(args);
}

// 手读 SSE:逐行切 `data: ` 帧,每帧一个 JSON。EventSource 只支持 GET,
// 所以这里用 fetch + ReadableStream 自己解析。
export async function* sseJsonEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith("data: ")) continue;
      yield JSON.parse(line.slice("data: ".length));
    }
  }
}

export const codexAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const lastUser = messages.findLast((m) => m.role === "user");
    const message =
      lastUser?.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n") ?? "";

    // fetch 带上 assistant-ui 的 abortSignal,自带的停止按钮就能直接取消这一轮
    // (服务端监听连接断开去 abort Codex 子进程);取消后 runtime 自己把消息标成
    // cancelled,这里不用特判 AbortError。
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, threadId }),
      signal: abortSignal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const state = createTurnState();
    for await (const event of sseJsonEvents(res.body)) {
      reduceEvent(state, event as ThreadEvent);
      if (state.threadId) threadId = state.threadId;
      yield { content: contentOf(state) };
    }
    if (state.errors.length > 0) {
      yield {
        content: contentOf(state),
        status: { type: "incomplete", reason: "error", error: state.errors.join("\n") },
      };
    }
  },
};
