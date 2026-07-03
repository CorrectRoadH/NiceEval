import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import "./App.css";

// Codex 线程续接靠 thread_id(落盘在 ~/.codex/sessions),不是靠重放完整消息
// 历史——服务端在 `thread.started` 事件里把它塞进 message.metadata.threadId,
// 前端存下来,下一轮请求带回去(见 server.ts 的 parseChatRequest)。
type ChatMessage = UIMessage<{ threadId?: string; usage?: unknown }>;

function App() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 最近一次从助手消息里拿到的 threadId,用 ref 是因为 transport 的闭包
  // 只会捕获创建时的值,要读"最新"值必须经 ref。
  const threadIdRef = useRef<string | undefined>(undefined);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, threadId: threadIdRef.current },
        }),
      }),
    [],
  );

  const { messages, status, sendMessage, stop } = useChat<ChatMessage>({ transport });

  const running = status === "submitted" || status === "streaming";
  // "思考中…"不能只看 status:服务端一发 start chunk(thread.started 时就发了),
  // useChat 就会先推入一条空 parts 的 assistant 消息,按 role 判断指示器会立刻消失,
  // 而 Codex 要等 item.completed 才有第一段可见内容——中间十几秒界面会完全空白。
  const lastMessage = messages.at(-1);
  const waitingForReply =
    running && (lastMessage?.role !== "assistant" || !hasVisibleContent(lastMessage));

  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const threadId = messages[i]?.metadata?.threadId;
      if (threadId) {
        threadIdRef.current = threadId;
        break;
      }
    }
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

  return (
    <main className="layout">
      <header className="header">
        <h1 className="title">Codex SDK Assistant</h1>
        <p className="subtitle">@openai/codex-sdk · workspace/</p>
      </header>

      <section className="messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {waitingForReply && <div className="msg assistant typing">思考中…</div>}
        <div ref={messagesEndRef} />
      </section>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
        <input
          type="text"
          className="text-input"
          placeholder="给 Codex 一个编码任务,比如“创建一个文件 hello.txt,内容是 hi”…"
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

function hasVisibleContent(message: ChatMessage): boolean {
  return message.parts.some(
    (part) => (part.type === "text" && part.text.length > 0) || isToolUIPart(part),
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
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
        // Codex 的 command_execution / file_change / mcp_tool_call / web_search /
        // todo_list / reasoning / error 这些 ThreadItem 类型,都被 ui-stream.ts
        // 映射成同一种"动态工具调用"气泡(见该文件注释)。
        if (isToolUIPart(part)) {
          const name = getToolName(part);
          if (part.state === "input-streaming" || part.state === "input-available") {
            return (
              <div key={part.toolCallId} className="tool-bubble">
                ⚙ {name}({JSON.stringify(part.input)})
              </div>
            );
          }
          if (part.state === "output-available") {
            return (
              <div key={part.toolCallId} className="tool-bubble">
                ⚙ {name} → {JSON.stringify((part as { output?: unknown }).output)}
              </div>
            );
          }
          if (part.state === "output-error") {
            return (
              <div key={part.toolCallId} className="tool-bubble error">
                ✗ {name}: {part.errorText}
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
