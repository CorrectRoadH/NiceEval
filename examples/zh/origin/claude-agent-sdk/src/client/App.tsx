import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import "./App.css";

// 复用 examples/zh/origin/ai-sdk-v7 的聊天界面骨架(消息列表 / 工具调用气泡 /
// 审批气泡),裁掉了这个 demo 用不上的模型选择器和图片上传。

type Metadata = { sessionId?: string };

function App() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 后端是"每轮一次 query() + resume 找回历史"的会话形态(见 agent.ts),
  // 不是整份 messages[] 重放——所以前端只需要记住最近一次拿到的
  // session_id,下一轮请求带回去就行。
  const sessionIdRef = useRef<string | undefined>(undefined);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, sessionId: sessionIdRef.current },
        }),
      }),
    [],
  );

  // 注意:这里没有接 sendAutomaticallyWhen /
  // lastAssistantMessageIsCompleteWithApprovalResponses(ai-sdk-v7 的
  // App.tsx 里用它们在审批完之后自动重发一次请求)。那一套是 AI SDK 自己
  // 工具循环的"停流 -> 客户端带着审批结果重放整段历史 -> 服务端续跑"模式。
  // 这个后端不是那样:SSE 连接在等审批期间整轮保持打开,agent.ts 的
  // canUseTool 直接挂在一个内存 Promise 上,浏览器点"允许/拒绝"只是一次
  // 独立的 fetch 去 resolve 那个 Promise,query() 的 stream 立刻接着往下走,
  // 不需要客户端再发一次消息。
  const { messages, status, sendMessage, stop } = useChat<UIMessage<Metadata>>({ transport });

  const running = status === "submitted" || status === "streaming";
  // "思考中…"不能只看 status:服务端一发 start chunk,useChat 就会先推入一条空 parts
  // 的 assistant 消息,按 role 判断指示器会立刻消失,首 token 到达前界面一片空白。
  const lastMessage = messages.at(-1);
  const waitingForReply =
    running && (lastMessage?.role !== "assistant" || !hasVisibleContent(lastMessage));

  useEffect(() => {
    const sid = messages.at(-1)?.metadata?.sessionId;
    if (sid) sessionIdRef.current = sid;
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    sendMessage({ text });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleApproval({ toolUseId, approved }: { toolUseId: string; approved: boolean }) {
    // 服务端保持这轮的 SSE 连接打开、在内存里 resolve 一个 Promise(见
    // pending-approvals.ts + agent.ts 的 canUseTool)——不是 ai-sdk-v7 那种
    // useChat 内建的 addToolApprovalResponse(那个是给"结束流、客户端重放"
    // 模式用的),所以这里直接 fetch 一个独立的审批端点,不经过 useChat。
    fetch("/api/chat/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolUseId, approved }),
    }).catch(() => {});
  }

  return (
    <main className="layout">
      <header className="header">
        <h1 className="title">Claude Agent SDK Assistant</h1>
      </header>

      <section className="messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onToolApproval={handleApproval} />
        ))}
        {waitingForReply && <div className="msg assistant typing">思考中…</div>}
        <div ref={messagesEndRef} />
      </section>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
        <input
          type="text"
          className="text-input"
          placeholder="发送消息…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        {running ? (
          <button type="button" className="send-btn stop-btn" onClick={stop}>停止</button>
        ) : (
          <button type="submit" className="send-btn" disabled={!input.trim()}>发送</button>
        )}
      </form>
    </main>
  );
}

function hasVisibleContent(message: UIMessage<Metadata>): boolean {
  return message.parts.some(
    (part) => (part.type === "text" && part.text.length > 0) || isToolUIPart(part),
  );
}

type ToolApprovalHandler = (args: { toolUseId: string; approved: boolean }) => void;

function MessageBubble({
  message,
  onToolApproval,
}: {
  message: UIMessage<Metadata>;
  onToolApproval: ToolApprovalHandler;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`msg-group ${isUser ? "user-group" : "assistant-group"}`}>
      {message.parts.map((part, i) => {
        if (part.type === "text" && part.text) {
          return (
            <div key={i} className={`msg ${isUser ? "user" : "assistant"}`}>
              <span style={{ whiteSpace: "pre-wrap" }}>{part.text}</span>
            </div>
          );
        }
        if (isToolUIPart(part)) {
          const state = part.state;
          const name = getToolName(part);
          if (state === "approval-requested") {
            return (
              <div key={part.toolCallId} className="tool-bubble approval-bubble">
                <div>⚠ 是否允许调用 {name}({JSON.stringify(part.input)}) ？</div>
                <div className="approval-actions">
                  <button
                    type="button"
                    className="approve-btn"
                    onClick={() => onToolApproval({ toolUseId: part.approval.id, approved: true })}
                  >
                    允许
                  </button>
                  <button
                    type="button"
                    className="deny-btn"
                    onClick={() => onToolApproval({ toolUseId: part.approval.id, approved: false })}
                  >
                    拒绝
                  </button>
                </div>
              </div>
            );
          }
          if (state === "input-streaming" || state === "input-available" || state === "approval-responded") {
            return (
              <div key={part.toolCallId} className="tool-bubble">
                ⚙ {name}({state === "input-streaming" ? "…" : JSON.stringify(part.input)})
              </div>
            );
          }
          if (state === "output-available") {
            return (
              <div key={part.toolCallId} className="tool-bubble">
                ⚙ {name} → {JSON.stringify((part as { output?: unknown }).output)}
              </div>
            );
          }
          if (state === "output-denied") {
            return (
              <div key={part.toolCallId} className="tool-bubble">
                ⛔ {name} 已被拒绝执行
              </div>
            );
          }
          if (state === "output-error") {
            return (
              <div key={part.toolCallId} className="tool-bubble">
                ✖ {name} 出错:{(part as { errorText?: string }).errorText}
              </div>
            );
          }
        }
        return null;
      })}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
