import { createRoot } from "react-dom/client";
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
} from "@assistant-ui/react";
import { codexAdapter, toolDetail } from "./codex-adapter.ts";
import "./App.css";

// 前端用 assistant-ui(@assistant-ui/react)的 headless primitives 搭 UI:
// useLocalRuntime + 自定义 ChatModelAdapter(见 codex-adapter.ts)消费 Codex SDK
// 的原生 SSE 协议(服务端把 ThreadEvent 原样透传,见 server.ts)。消息列表、
// composer、停止/取消、思考中指示全部由 assistant-ui 管,这里只写各 part 的渲染。

function App() {
  const runtime = useLocalRuntime(codexAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root asChild>
        <main className="layout">
          <header className="header">
            <h1 className="title">Codex SDK Assistant</h1>
            <p className="subtitle">@openai/codex-sdk · workspace/</p>
          </header>

          <ThreadPrimitive.Viewport className="messages">
            <ThreadPrimitive.Messages>
              {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>

          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input
              className="text-input"
              placeholder="给 Codex 一个编码任务,比如“创建一个文件 hello.txt,内容是 hi”…"
              rows={1}
              maxRows={6}
              autoComplete="off"
            />
            <AuiIf condition={(s) => !s.thread.isRunning}>
              <ComposerPrimitive.Send className="send-btn">发送</ComposerPrimitive.Send>
            </AuiIf>
            <AuiIf condition={(s) => s.thread.isRunning}>
              <ComposerPrimitive.Cancel className="send-btn stop-btn">停止</ComposerPrimitive.Cancel>
            </AuiIf>
          </ComposerPrimitive.Root>
        </main>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="msg-group user-group">
      <div className="msg user">
        <MessagePrimitive.Parts>
          {({ part }) =>
            part.type === "text" ? <span style={{ whiteSpace: "pre-wrap" }}>{part.text}</span> : null
          }
        </MessagePrimitive.Parts>
      </div>
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
              // 消息还没有任何 part 时,assistant-ui 会合成一个空的 running text
              // part 让我们渲染等待态。Codex 首个 item 到达前(spawn 子进程 +
              // 模型响应)有很长的空窗,必须有指示器兜底。
              if (!part.text) {
                return part.status?.type === "running"
                  ? <div className="msg assistant typing">思考中…</div>
                  : null;
              }
              return (
                <div className="msg assistant">
                  <span style={{ whiteSpace: "pre-wrap" }}>{part.text}</span>
                </div>
              );
            case "reasoning":
              if (!part.text) return null;
              return <div className="tool-bubble">💭 {part.text}</div>;
            case "tool-call":
              return (
                <div className={`tool-bubble${part.isError ? " error" : ""}`}>
                  ⚙ {part.toolName} → {toolDetail(part)}
                </div>
              );
            default:
              return null;
          }
        }}
      </MessagePrimitive.Parts>
      <AssistantMessageError />
    </MessagePrimitive.Root>
  );
}

// turn.failed / error 事件在 adapter 里被折成消息的 incomplete/error 状态
// (用户点停止是 cancelled,不在这里展示)。
function AssistantMessageError() {
  const error = useAuiState((s) =>
    s.message.status?.type === "incomplete" && s.message.status.reason === "error"
      ? String(s.message.status.error ?? "未知错误")
      : undefined,
  );
  if (error === undefined) return null;
  return <div className="msg error">错误: {error}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
