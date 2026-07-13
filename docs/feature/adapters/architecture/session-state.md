# 会话与 HITL 状态模型

每条 eval session 持有独立 `AgentSession`，生命周期与 attempt 绑定。

```ts
interface AgentSession {
  readonly id?: string;
  capture(id: string | undefined): void;
  history<T>(): { get(): T[]; commit(messages: T[]): void };
  hold<T>(state: T): void;
  take<T>(): T | undefined;
  readonly state: Record<string, unknown>;
}
```

## 状态不变量

- 服务端历史模式使用 `id` / `capture()`；客户端历史模式使用 `history()`，不维护两份会话真相。
- `capture()` first-writer-wins，resume 轮不能替换原 ID。
- 新 session 的 ID 为 undefined、历史为空，因此 `newSession()` 不需要供应商分支。
- `hold()` / `take()` 保存未消费流的暂停现场；`take()` 一次消费。
- 会话状态不得放在模块级 Map，避免并发 attempt 和新 session 串线。

## HITL 握手不变量

```text
send(prompt)
  ← Turn { status: waiting, events: [..., input.requested] }
requireInputRequest(filter)
respond({ requestId, optionId | text })
  → 同一 AgentSession 恢复
  ← Turn { status: completed | waiting, events: [...] }
```

waiting、请求事件、结构化 request ID 和同一会话恢复缺一不可。`respond` 是同一 session 的下一轮 send，不是运行器绕过 Adapter 调用供应商 API。
