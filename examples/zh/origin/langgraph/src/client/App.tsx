// 官方推荐的 LangGraph 聊天前端:@langchain/react 的 useStream() 直连 Agent Server
// (langgraphjs dev,默认 http://localhost:2024)。消息流、token 拼接、工具调用
// 生命周期(pending -> success,含参数和结果)、线程管理全部由 hook 处理——
// 不需要自己写 fetch/SSE 解析。
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useStream } from "@langchain/react";
import "./App.css";

// Agent Server 的地址与 langgraph.json 里的 graph id("agent")。
const API_URL = "http://localhost:2024";
const ASSISTANT_ID = "agent";

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "object" && block !== null && "text" in block ? String(block.text) : ""))
      .join("");
  }
  return "";
}

function App() {
  // thread = 会话:第一轮传 null,服务器自己建线程、经 onThreadId 发回来,
  // 之后同一个 thread 内的多轮对话有记忆(dev 模式存内存,重启即丢)。
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const stream = useStream({
    apiUrl: API_URL,
    assistantId: ASSISTANT_ID,
    threadId,
    onThreadId: setThreadId,
  });

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || stream.isLoading) return;
    setDraft("");
    void stream.submit({ messages: [{ type: "human", content: text }] });
  };

  return (
    <main>
      <h1>LangGraph / LangChain + LangSmith OTel 示例</h1>
      <p className="subtitle">试着问"北京天气怎么样"或"12*(3+4)等于多少"触发工具调用。</p>

      {/* stream.toolCalls 是响应式的工具调用句柄(status/input/output 随事件原地
          更新);ai 消息自己的 tool_calls 里有同一个 call id,借它把句柄挂回消息。 */}
      <div id="log">
        {stream.messages.map((msg, i) => {
          if (msg.type === "human") {
            return (
              <div key={msg.id ?? i} className="msg user">
                {contentText(msg.content)}
              </div>
            );
          }
          if (msg.type !== "ai") return null;
          const text = contentText(msg.content);
          const msgToolCalls = (msg as { tool_calls?: Array<{ id?: string }> }).tool_calls ?? [];
          const callIds = new Set(msgToolCalls.map((call) => call.id));
          const calls = stream.toolCalls.filter((call) => callIds.has(call.id));
          return (
            <div key={msg.id ?? i} className="turn">
              {calls.map((call) => (
                <details key={call.id} className={"tool-call" + (call.status === "running" ? " pending" : "")}>
                  <summary>⚙ {call.name}</summary>
                  <pre>
                    {"input:  " + JSON.stringify(call.input, null, 2) + "\n"}
                    {"output: " +
                      (call.status === "error"
                        ? `错误: ${call.error ?? "unknown"}`
                        : call.output !== null
                          ? JSON.stringify(call.output)
                          : "…")}
                  </pre>
                </details>
              ))}
              {text.length > 0 && <div className="msg assistant">{text}</div>}
            </div>
          );
        })}
        {stream.error != null && (
          <div className="msg error">错误: {stream.error instanceof Error ? stream.error.message : String(stream.error)}</div>
        )}
      </div>

      <div id="threadInfo">{threadId ? `thread: ${threadId}` : "新会话(发送第一条消息后由服务器建线程)"}</div>

      <form onSubmit={send}>
        <div>
          <input
            type="text"
            value={draft}
            placeholder="输入消息…"
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          {stream.isLoading ? (
            <button type="button" onClick={() => void stream.stop()}>
              停止
            </button>
          ) : (
            <button type="submit">发送</button>
          )}
        </div>
      </form>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
