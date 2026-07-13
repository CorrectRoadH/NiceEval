# 标准事件模型

`Turn.events` 是断言的唯一行为数据源。Adapter 将 SDK 事件、结构化响应或 transcript 归一成中性事件，core 再从中派生工具、subagent、HITL 和消息事实。

## 数据结构

```ts
type StreamEvent =
  | { type: "message"; role: "assistant" | "user"; text: string; loc?: SourceLoc }
  | { type: "action.called"; callId: string; name: string; input: JsonValue; tool?: ToolName }
  | { type: "action.result"; callId: string; output?: JsonValue;
      status: "completed" | "failed" | "rejected" }
  | { type: "skill.loaded"; skill: string; callId?: string }
  | { type: "subagent.called"; callId: string; name: string; remoteUrl?: string }
  | { type: "subagent.completed"; callId: string; output?: JsonValue;
      status: "completed" | "failed" }
  | { type: "input.requested"; request: InputRequest }
  | { type: "thinking"; text: string }
  | { type: "compaction"; reason?: string }
  | { type: "error"; message: string };
```

## 不变量

1. 保持原始发生顺序，不按事件类型重排。
2. action called/result 与 subagent called/completed 使用稳定 call ID 配对。
3. `name` 保留原始工具名，`tool` 保存跨 Agent 规范名。
4. 人工拒绝是 `rejected`，执行故障是 `failed`。
5. Skill 加载只产 `skill.loaded`，不重复计入工具调用。
6. 原始协议没有 usage 时省略，不编造数值。

## InputRequest

```ts
interface InputRequest {
  readonly id?: string;
  readonly prompt?: string;
  readonly display?: string;
  readonly action?: string;
  readonly input?: JsonValue;
  readonly options?: readonly { id: string; label?: string }[];
}
```

一个原生问题只产一条请求事件。字段应足以让 eval 按 ID、文本、动作、参数和选项进行匹配。

## 派生事实

`deriveRunFacts(events)` 统一折叠工具调用、subagent 调用、待输入请求、parked、消息数和压缩次数。Adapter 不预计算断言结果。只有 called 或只有 result 的情况属于 core 容错，不是正常映射契约。
