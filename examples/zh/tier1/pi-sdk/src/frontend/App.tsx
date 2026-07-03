import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
  type ToolCallMessagePart,
} from "@assistant-ui/react";
import "./App.css";

// 前端直接消费 pi 的原生协议:服务端把 `AgentEvent` 原样透传成 SSE(见
// server.ts)。这里用 assistant-ui 的 LocalRuntime:ChatModelAdapter.run 是一个
// async generator,fetch /api/chat 逐帧解析 SSE,把 AgentEvent 累积成 assistant-ui
// 的 content parts 数组,每帧 yield 全量(assistant-ui 要求 yield 完整累积状态,
// 不是增量)。UI 层用 headless primitives(Thread/Message/Composer)自己画气泡。
//
// 除 AgentEvent 外只有三种传输层帧:session(会话 id)/ approval_request
// (HITL)/ server_error,见 server.ts 文件头注释。

// 服务器透传帧 = AgentEvent ∪ 三种传输层帧。
type ServerFrame =
  | AgentEvent
  | { type: "session"; sessionId: string }
  | { type: "approval_request"; toolCallId: string; toolName: string; args: unknown }
  | { type: "server_error"; message: string };

// 会话 id 由服务端第一帧下发,下一轮请求带回去续接(服务端内存存历史,
// 不带就丢上下文)。跨 run 存活,所以放在 adapter 闭包外的模块级。
const sessionIdRef: { current: string | undefined } = { current: undefined };

// 审批状态放模块级外部 store,UI 用 useSyncExternalStore 订阅。实测 assistant-ui
// 的 LocalRuntime 不会保留 adapter yield 的 tool-call part 上的自定义字段
// (artifact 是工具执行侧的槽位,不是给 adapter 用的),所以这种 UI-only 状态
// 不能挂在 part 上。denied 是终态:pi 对被拒的调用只发一个 isError 的
// tool_execution_end,靠它区分"已拒绝"和普通报错。
type ApprovalState = "pending" | "decided" | "denied";
const approvalStates = new Map<string, ApprovalState>();
const approvalListeners = new Set<() => void>();
function setApprovalState(toolCallId: string, state: ApprovalState) {
  if (approvalStates.get(toolCallId) === "denied") return;
  approvalStates.set(toolCallId, state);
  for (const listener of approvalListeners) listener();
}
function subscribeApprovals(callback: () => void): () => void {
  approvalListeners.add(callback);
  return () => approvalListeners.delete(callback);
}
function useApprovalState(toolCallId: string): ApprovalState | undefined {
  return useSyncExternalStore(subscribeApprovals, () => approvalStates.get(toolCallId));
}

const piAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const last = messages.at(-1);
    const message =
      last?.role === "user"
        ? last.content.map((p) => (p.type === "text" ? p.text : "")).join("")
        : "";

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, sessionId: sessionIdRef.current }),
      signal: abortSignal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    // 有序 part 列表 + key -> index。AssistantMessageEvent 的 contentIndex 每个
    // turn 从 0 重数,text/thinking 要拼上 turn 序号做 key 才不撞车;工具 part
    // 直接用 toolCallId(approval_request / tool_execution_* 三种帧共用一个 part)。
    const parts: ThreadAssistantMessagePart[] = [];
    const indexByKey = new Map<string, number>();
    let turnIndex = -1;

    const upsert = (
      key: string,
      make: () => ThreadAssistantMessagePart,
      update: (part: ThreadAssistantMessagePart) => ThreadAssistantMessagePart,
    ) => {
      const i = indexByKey.get(key);
      if (i === undefined) {
        indexByKey.set(key, parts.length);
        parts.push(make());
      } else {
        parts[i] = update(parts[i]);
      }
    };

    try {
      for await (const raw of sseJsonFrames(res.body)) {
        const frame = raw as ServerFrame;
        switch (frame.type) {
          case "session":
            sessionIdRef.current = frame.sessionId;
            continue;
          case "turn_start":
            turnIndex += 1;
            continue;
          case "message_update": {
            const e = frame.assistantMessageEvent;
            if (!("contentIndex" in e)) continue; // done/error 帧
            const key = `t${turnIndex}-${e.contentIndex}`;
            const kind = e.type.startsWith("thinking")
              ? ("reasoning" as const)
              : ("text" as const);
            if (e.type === "text_start" || e.type === "thinking_start") {
              upsert(key, () => ({ type: kind, text: "" }), (p) => p);
            } else if (e.type === "text_delta" || e.type === "thinking_delta") {
              upsert(
                key,
                () => ({ type: kind, text: e.delta }),
                (p) => ("text" in p ? { ...p, text: p.text + e.delta } : p),
              );
            } else if (e.type === "text_end" || e.type === "thinking_end") {
              upsert(
                key,
                () => ({ type: kind, text: e.content }),
                (p) => ("text" in p ? { ...p, text: e.content } : p),
              );
            } else {
              continue; // toolcall_*:工具展示走 tool_execution_* 帧
            }
            break;
          }
          case "approval_request":
            setApprovalState(frame.toolCallId, "pending");
            upsert(
              frame.toolCallId,
              () => makeToolPart(frame.toolCallId, frame.toolName, frame.args),
              (p) => p,
            );
            break;
          case "tool_execution_start":
            upsert(
              frame.toolCallId,
              () => makeToolPart(frame.toolCallId, frame.toolName, frame.args),
              (p) => p,
            );
            break;
          case "tool_execution_end": {
            const result = toolResultText(frame.result);
            upsert(
              frame.toolCallId,
              () => ({
                ...makeToolPart(frame.toolCallId, frame.toolName, undefined),
                result,
                isError: frame.isError,
              }),
              (p) => (p.type === "tool-call" ? { ...p, result, isError: frame.isError } : p),
            );
            break;
          }
          case "server_error":
            parts.push({ type: "text", text: `错误: ${frame.message}` });
            break;
          default:
            // agent_start/agent_end/turn_end/message_start/message_end/
            // tool_execution_update:demo 里用不上,原样忽略。
            continue;
        }
        yield { content: [...parts] };
      }
    } catch (err) {
      // 用户点"停止":fetch 被 abort,不算错误,静默结束这次 run。
      if (abortSignal.aborted) return;
      throw err;
    }
  },
};

function makeToolPart(toolCallId: string, toolName: string, args: unknown): ToolCallMessagePart {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    args: (args ?? {}) as ToolCallMessagePart["args"],
    argsText: JSON.stringify(args ?? {}),
  };
}

// pi 的 ToolResult:content 是 [{type:"text", text}] 块,details 是结构化结果。
function toolResultText(result: unknown): string {
  const r = result as { content?: Array<{ type?: string; text?: string }>; details?: unknown } | undefined;
  if (r?.details !== undefined) return JSON.stringify(r.details);
  const textBlock = r?.content?.find((c) => c.type === "text" && typeof c.text === "string");
  return textBlock?.text ?? "";
}

// 手读 SSE:逐行切 `data: ` 帧,每帧一个 JSON。EventSource 只支持 GET,
// 所以这里用 fetch + ReadableStream 自己解析。
async function* sseJsonFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown, void> {
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

function App() {
  const runtime = useLocalRuntime(piAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="layout">
        <header className="header">
          <h1 className="title">pi-sdk example</h1>
        </header>

        <ThreadPrimitive.Viewport className="messages">
          <ThreadPrimitive.Messages>
            {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>

        <Composer />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="msg-group user-group">
      <MessagePrimitive.Parts>
        {({ part }) =>
          part.type === "text" ? (
            <div className="msg user">
              <MessagePartPrimitive.Text />
            </div>
          ) : null
        }
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="msg-group assistant-group">
      <MessagePrimitive.Parts>
        {({ part }) => {
          switch (part.type) {
            case "text":
              // 消息还没有任何 part 时 assistant-ui 会合成一个空 text part
              //(status running)让 UI 画等待态;真实空 text 不渲染。
              if (!part.text) {
                return part.status.type === "running" ? (
                  <div className="msg assistant typing">思考中…</div>
                ) : null;
              }
              return (
                <div className="msg assistant">
                  <MessagePartPrimitive.Text />
                </div>
              );
            case "reasoning":
              return part.text ? <div className="tool-bubble">💭 {part.text}</div> : null;
            case "tool-call":
              return <ToolCallView part={part} />;
            default:
              return null;
          }
        }}
      </MessagePrimitive.Parts>
      <MessagePrimitive.Error>
        <div className="msg assistant">
          错误: <ErrorPrimitive.Message />
        </div>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

function ToolCallView({ part }: { part: ToolCallMessagePart }) {
  const approval = useApprovalState(part.toolCallId);
  if (approval === "denied") return <div className="tool-bubble">⛔ {part.toolName} 已被拒绝执行</div>;
  if (approval === "pending") return <ApprovalBubble part={part} />;
  if (part.isError) return <div className="tool-bubble">✖ {part.toolName} 出错:{String(part.result ?? "")}</div>;
  return (
    <div className="tool-bubble">
      ⚙ {part.toolName}({JSON.stringify(part.args)})
      {part.result !== undefined ? ` → ${String(part.result)}` : ""}
    </div>
  );
}

function ApprovalBubble({ part }: { part: ToolCallMessagePart }) {
  // 审批走独立端点,resolve 服务端内存里挂着的 Promise(见 server.ts),
  // 原来那条 /api/chat 的 SSE 流随后自己继续,后续帧(tool_execution_*)
  // 会把这个 part 更新成工具气泡。
  const respond = (approved: boolean) => {
    setApprovalState(part.toolCallId, approved ? "decided" : "denied");
    void fetch("/api/chat/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolUseId: part.toolCallId, approved }),
    });
  };
  return (
    <div className="tool-bubble approval-bubble">
      <div>⚠ 是否允许调用 {part.toolName}({JSON.stringify(part.args)}) ？</div>
      <div className="approval-actions">
        <button type="button" className="approve-btn" onClick={() => respond(true)}>允许</button>
        <button type="button" className="deny-btn" onClick={() => respond(false)}>拒绝</button>
      </div>
    </div>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="composer">
      <ComposerPrimitive.Input className="text-input" placeholder="发送消息…" rows={1} autoComplete="off" />
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send className="send-btn">发送</ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel className="send-btn stop-btn">停止</ComposerPrimitive.Cancel>
      </AuiIf>
    </ComposerPrimitive.Root>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
