import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import "./App.css";

function App() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 后端(server.ts)每次请求都 new 一个全新 Agent、不维护跨请求历史(见 agent.ts 顶部
  // 注释),所以只需要这一轮的用户文本，不用把 DefaultChatTransport 默认发送的整份
  // UIMessage[] 历史转过去——prepareSendMessagesRequest 把请求体换成 { message }。
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({ body: { message: lastUserText(messages) } }),
      }),
    [],
  );

  // 没有传 sendAutomaticallyWhen —— 审批的允许/拒绝走下面 MessageBubble 里的 plain
  // fetch('/api/chat/approve')，不经过 useChat 的消息状态，所以不需要 AI SDK 帮我们把
  // 审批决定重新打包成一条消息发回服务端。
  const { messages, status, sendMessage, stop } = useChat({ transport });

  const running = status === "submitted" || status === "streaming";

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

  return (
    <main className="layout">
      <header className="header">
        <h1 className="title">pi-sdk example</h1>
      </header>

      <section className="messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {running && messages.at(-1)?.role !== "assistant" && (
          <div className="msg assistant typing">思考中…</div>
        )}
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

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  function approve(toolCallId: string, approved: boolean) {
    // 服务端的 HITL 状态是 server.ts 里进程内的 pendingApprovals Map，键就是
    // toolCallId——不是 AI SDK 原生的 tool-approval-response 协议，所以这里直接命中
    // 自定义端点，不用 useChat 的 addToolApprovalResponse。
    void fetch("/api/chat/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolUseId: toolCallId, approved }),
    });
  }

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
                    onClick={() => approve(part.toolCallId, true)}
                  >
                    允许
                  </button>
                  <button
                    type="button"
                    className="deny-btn"
                    onClick={() => approve(part.toolCallId, false)}
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
        }
        return null;
      })}
    </div>
  );
}

function lastUserText(messages: UIMessage[]): string {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

createRoot(document.getElementById("root")!).render(<App />);
