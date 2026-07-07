import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type EmptyMessagePartComponent,
  type TextMessagePartComponent,
  type ReasoningMessagePartComponent,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import {
  claudeAgentAdapter,
  GATED_TOOL_NAME,
  getApprovalState,
  respondApproval,
  subscribeApprovals,
} from "./adapter.ts";
import "./App.css";

// 前端基于 assistant-ui 的 headless primitives(useLocalRuntime + Thread/
// Message/Composer),SDKMessage 流的解析在 ./adapter.ts 的 ChatModelAdapter
// 里(对比 examples/zh/origin/ai-sdk-v7 用的 AI SDK UI Message Stream +
// useChat)。这里只负责渲染:气泡样式沿用旧版 App.css 的暗色风格。

function App() {
  const runtime = useLocalRuntime(claudeAgentAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="layout">
        <header className="header">
          <h1 className="title">Claude Agent SDK Assistant</h1>
        </header>

        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="messages">
            <ThreadPrimitive.Messages>
              {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>

        <Composer />
      </main>
    </AssistantRuntimeProvider>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="msg-group user-group">
      <MessagePrimitive.Parts components={{ Text: UserText }} />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="msg-group assistant-group">
      {/* showEmptyOnNonTextEnd 关掉:等待态只在"整条消息还没有任何 part"时出
          现(对齐旧版行为),工具执行/审批期间不再额外画一个 思考中…。 */}
      <MessagePrimitive.Parts
        unstable_showEmptyOnNonTextEnd={false}
        components={{
          Text: AssistantText,
          Reasoning: ReasoningBubble,
          Empty: Typing,
          tools: { Fallback: ToolBubble },
        }}
      />
    </MessagePrimitive.Root>
  );
}

const UserText: TextMessagePartComponent = ({ text }) => (
  <div className="msg user">
    <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
  </div>
);

const AssistantText: TextMessagePartComponent = ({ text }) => {
  if (!text) return null;
  return (
    <div className="msg assistant">
      <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
    </div>
  );
};

// thinking 块映射成 reasoning part(旧版直接忽略;assistant-ui 有原生槽位就展示)。
const ReasoningBubble: ReasoningMessagePartComponent = ({ text }) => {
  if (!text) return null;
  return (
    <div className="msg assistant reasoning">
      <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
    </div>
  );
};

// 消息还没有任何 part(或最后一个 part 是 tool-call)且在运行中时的等待态。
const Typing: EmptyMessagePartComponent = ({ status }) => {
  if (status.type !== "running") return null;
  return <div className="msg assistant typing">思考中…</div>;
};

// 审批状态在 adapter.ts 的模块级外部 store 里(SSE 流在等待期间一直开着,
// assistant-ui 的消息状态机不参与审批),这里订阅它驱动按钮显隐。
function useApprovalState(toolUseId: string) {
  return useSyncExternalStore(subscribeApprovals, () => getApprovalState(toolUseId));
}

const ToolBubble: ToolCallMessagePartComponent = ({ toolCallId, toolName, argsText, result, isError }) => {
  const approval = useApprovalState(toolCallId);
  if (approval === "denied") {
    return <div className="tool-bubble">⛔ {toolName} 已被拒绝执行</div>;
  }
  if (approval === "pending" && toolName === GATED_TOOL_NAME) {
    return (
      <div className="tool-bubble approval-bubble">
        <div>⚠ 是否允许调用 {toolName}({argsText}) ？</div>
        <div className="approval-actions">
          <button type="button" className="approve-btn" onClick={() => respondApproval(toolCallId, true)}>
            允许
          </button>
          <button type="button" className="deny-btn" onClick={() => respondApproval(toolCallId, false)}>
            拒绝
          </button>
        </div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="tool-bubble">
        ✖ {toolName} 出错:{String(result ?? "")}
      </div>
    );
  }
  return (
    <div className="tool-bubble">
      ⚙ {toolName}({argsText || "…"})
      {result !== undefined ? ` → ${String(result)}` : ""}
    </div>
  );
};

function Composer() {
  return (
    <ComposerPrimitive.Root className="composer">
      <ComposerPrimitive.Input className="text-input" placeholder="发送消息…" autoComplete="off" rows={1} />
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send className="send-btn">发送</ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        {/* thread composer 的 Cancel 调 cancelRun():中断 adapter 的 abortSignal
            → fetch 中断 → 服务端 req close 时 interrupt 这一轮 query()。 */}
        <ComposerPrimitive.Cancel className="send-btn stop-btn">停止</ComposerPrimitive.Cancel>
      </AuiIf>
    </ComposerPrimitive.Root>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
