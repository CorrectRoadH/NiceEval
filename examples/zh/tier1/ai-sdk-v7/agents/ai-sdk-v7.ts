// ai-sdk-v7 的 adapter:黑盒对接 ../src/backend/server.ts 的 AI SDK UI Message Stream
// 协议(标准 SSE,`data: {...}\n\n`,以 `data: [DONE]\n\n` 收尾)。这是五个应用里唯一"客户端带
// 全量历史"的会话形态——服务端零状态,每轮请求体都要带上完整的 UIMessage[]。
//
// 事件来源:`events: otelEvents({ dialects: [otel.genAi] })`——应用用官方 @ai-sdk/otel 集成,
// 产标准 GenAI semconv span,工具断言 / 消息 / usage / 瀑布图全从 span 派生,SSE 只用来:
//   1. 重建 assistant 消息本身,喂回下一轮请求体(这是会话续接的唯一机制,不是给断言用的);
//   2. 识别 HITL 停在哪(tool 类型 part 进入 "approval-requested" 状态)。
// `readUIMessageStream`("ai" 包导出的框架无关 reducer,`useChat` 内部用的就是它)把裸 SSE
// chunk 流归约成逐步完整的 UIMessage 快照,不用自己手写状态机。
//
// HITL:calculate 工具声明了 needsApproval:true。**没有 approve 端点**——批准/拒绝的决定是把
// 上一条(还停在 approval-requested 状态的)assistant 消息原地改成 approval-responded,原样
// 重发整个 messages 数组触发服务端续跑(和真实前端 `addToolApprovalResponse` + `sendMessage()`
// 的效果完全一致,这里手动做同样的事)。approval.id 不是 toolCallId,是流里单独发的
// approvalId(打帧确认过,见 tool-approval-request chunk)。
import { defineAgent, otelEvents, otel } from "niceeval/adapter";
import type { AgentContext } from "niceeval/adapter";
import type { JsonValue, StreamEvent, Turn, TurnInput } from "niceeval";
import { readUIMessageStream, type UIMessage, type UIMessageChunk, type UIMessagePart } from "ai";
import { ensureServer } from "./server-lifecycle.ts";

// gated 工具:实测发现 @ai-sdk/otel 不给 needsApproval 工具的实际执行(approve 之后真正跑
// execute() 那一步)产 execute_tool 类型 span——get_weather 这类普通工具完全正常(genAi 方言
// 派生的 action.called/result 齐全,见 evals/weather-tool.eval.ts),只有 calculate 这种走
// 审批续跑路径的调用,span 派生对它完全空白。deny 分支更彻底:被拒绝的调用在 SSE 里连
// tool-output-* 帧都不会有(拒绝是在转成 ModelMessage 历史时合成的,不经过真实一轮流),
// 只能靠这里手动补。
const GATED_TOOLS = new Set(["calculate"]);

// BatchSpanProcessor 的调度延迟(tracing.env 已经调到 200ms)和"这一轮请求几时返回"是两条
// 独立时间线,等 2-3 个调度周期,让最后一批 span 有时间落进 niceeval 的收集窗口。
const OTEL_FLUSH_GRACE_MS = 600;

// sessionId -> 完整对话历史(服务端零状态,每轮都要把这份历史原样带回去)。
const sessions = new Map<string, UIMessage[]>();

async function* parseSseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<UIMessageChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const sepIndex = buffer.indexOf("\n\n");
    if (sepIndex !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const line = rawEvent.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        const payload = line.slice("data: ".length);
        if (payload !== "[DONE]") yield JSON.parse(payload) as UIMessageChunk;
      }
      continue;
    }
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
  }
}

/** 把解析好的 chunk 生成器包成 readUIMessageStream 要的 ReadableStream,顺带旁路探测错误帧。 */
function toChunkStream(body: ReadableStream<Uint8Array>, onChunk: (c: UIMessageChunk) => void): ReadableStream<UIMessageChunk> {
  const gen = parseSseChunks(body);
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) {
        controller.close();
        return;
      }
      onChunk(value);
      controller.enqueue(value);
    },
  });
}

function isApprovalRequested(part: UIMessagePart<never, never>): part is UIMessagePart<never, never> & {
  toolCallId: string;
  input: unknown;
  approval: { id: string };
} {
  return (
    (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
    (part as { state?: string }).state === "approval-requested"
  );
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const server = await ensureServer({ telemetryEnv: ctx.telemetry?.env });

  if (ctx.session.isNew) ctx.session.id = crypto.randomUUID();
  const sessionId = ctx.session.id!;
  const history = sessions.get(sessionId) ?? [];

  const lastMessage = history.at(-1);
  const pendingPart =
    lastMessage?.role === "assistant" ? (lastMessage.parts as UIMessagePart<never, never>[]).find(isApprovalRequested) : undefined;

  let messagesToSend: UIMessage[];
  let resumeFrom: UIMessage | undefined;
  // gated 工具(calculate)审批续跑时手动补的 action.called/result,见文件头注释;
  // 非 gated 工具(get_weather 等)或非续跑轮次留空,完全交给 span 派生。
  const gatedEvents: StreamEvent[] = [];
  let awaitingGatedOutput: string | undefined; // 批准分支等 tool-output-available 时,记着等哪个 toolCallId

  if (pendingPart) {
    // HITL 续跑:不追加新的 user 消息——把停在 approval-requested 的那个 part 原地改成
    // approval-responded,原样重发整个历史,触发服务端续跑同一条被打断的 assistant 消息。
    const approved = input.text.trim().toLowerCase() === "approve";
    const toolName = pendingPart.type === "dynamic-tool" ? "dynamic-tool" : pendingPart.type.replace(/^tool-/, "");
    const mutatedParts = (lastMessage!.parts as UIMessagePart<never, never>[]).map((part) =>
      isApprovalRequested(part) && part.approval.id === pendingPart.approval.id
        ? {
            ...part,
            state: "approval-responded",
            approval: {
              id: pendingPart.approval.id,
              approved,
              // reason 不是协议要求的必填字段(拒绝一样能正确落成 execution-denied 的
              // tool-result,不给 reason 也不会报错),但 @ai-sdk/openai 会把它原样转成
              // 模型看到的工具结果文本(没给就是泛泛的 "Tool call execution denied.")——
              // 写清楚"别重试"能明显降低模型重新发起同一个调用的概率(实测复现过这个模型
              // 重试行为,同 memory 里 claude-sdk / langgraph 的记录)。
              ...(approved ? {} : { reason: "用户拒绝了这次调用,不要重试,直接告知用户未能计算。" }),
            },
          }
        : part,
    );
    resumeFrom = { ...lastMessage!, parts: mutatedParts } as UIMessage;
    messagesToSend = [...history.slice(0, -1), resumeFrom];

    if (GATED_TOOLS.has(toolName)) {
      gatedEvents.push({
        type: "action.called",
        callId: pendingPart.toolCallId,
        name: toolName,
        input: pendingPart.input as JsonValue,
      });
      if (approved) {
        // 批准:真的会执行,下面从 tool-output-available 帧里补 action.result(见 onChunk)。
        awaitingGatedOutput = pendingPart.toolCallId;
      } else {
        // 拒绝:没有真的执行,SSE 里连 tool-output-* 帧都不会有(见文件头注释),这一对
        // called+result 只能现在就手动补——已知齐全的信息(toolCallId/name/input)够用。
        gatedEvents.push({ type: "action.result", callId: pendingPart.toolCallId, status: "rejected" });
      }
    }
  } else {
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: input.text }],
    } as UIMessage;
    messagesToSend = [...history, userMessage];
  }

  const res = await fetch(`${server.baseUrl}/api/chat`, {
    method: "POST",
    // traceparent 随请求带过去:应用用官方 @ai-sdk/otel 集成(标准 Node OTel API),支持
    // context 传播,并发归属能精确到 traceId,不用退化到时间窗口串行。
    headers: { "content-type": "application/json", ...ctx.telemetry?.headers },
    body: JSON.stringify({ messages: messagesToSend, model: ctx.model }),
    signal: ctx.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }

  let sawError: string | undefined;
  const chunkStream = toChunkStream(res.body, (c) => {
    if (c.type === "error") sawError = c.errorText;
    // 批准分支:真的执行了,SSE 会吐 tool-output-available,把 action.result 补完整。
    if (c.type === "tool-output-available" && c.toolCallId === awaitingGatedOutput) {
      gatedEvents.push({ type: "action.result", callId: c.toolCallId, output: c.output as JsonValue, status: "completed" });
      awaitingGatedOutput = undefined;
    }
  });

  let finalMessage: UIMessage | undefined;
  for await (const msg of readUIMessageStream({ message: resumeFrom, stream: chunkStream })) {
    finalMessage = msg;
  }
  if (!finalMessage) throw new Error("流结束了但一条 assistant 消息都没收到");

  // 续跑分支:finalMessage 是同一条 assistant 消息的完整版,替换掉 messagesToSend 末尾那条
  // 还停在 approval-responded 状态的半成品,不是新追加一条。全新一轮:直接追加在后面。
  const newHistory = resumeFrom ? [...messagesToSend.slice(0, -1), finalMessage] : [...messagesToSend, finalMessage];
  sessions.set(sessionId, newHistory);

  const stillWaiting = (finalMessage.parts as UIMessagePart<never, never>[]).some(isApprovalRequested);
  if (stillWaiting) {
    // 模型被拒绝一次后有时会不死心、原样再试一次同一个工具调用(在 claude-sdk / langgraph
    // 的接入里都复现过),这里又会命中一次新的 approval-requested——gatedEvents 里上一轮的
    // called/result(rejected)照样要带出去,不能因为又停下来了就丢掉。
    const request = (finalMessage.parts as UIMessagePart<never, never>[]).find(isApprovalRequested)!;
    return {
      status: "waiting",
      events: [
        ...gatedEvents,
        {
          type: "input.requested",
          request: {
            id: request.approval.id,
            action: request.type === "dynamic-tool" ? "dynamic-tool" : request.type.replace(/^tool-/, ""),
            input: request.input as never,
            options: [{ id: "approve" }, { id: "deny" }],
          },
        },
      ],
    };
  }

  // 轮次真正结束(非 waiting)才等 flush grace——图/流还停在中断点时没有"这一轮的 otel 导出"
  // 这回事,没必要等。
  await new Promise((resolve) => setTimeout(resolve, OTEL_FLUSH_GRACE_MS));
  return {
    status: sawError ? "failed" : "completed",
    events: [...gatedEvents, ...(sawError ? [{ type: "error" as const, message: sawError }] : [])],
  };
}

export default defineAgent({
  name: "ai-sdk-v7",
  capabilities: {
    // 验证过:isNew 时生成新 sessionId、非 isNew 时按 sessionId 找回完整历史并原样重发,
    // 服务端零状态、续接完全靠客户端重放。
    conversation: true,
    // 验证过:get_weather / calculate 每次调用的 action.called/action.result 都从
    // GenAI semconv span 派生,覆盖完整,无遗漏。
    toolObservability: true,
  },
  events: otelEvents({ dialects: [otel.genAi] }),
  tracing: {
    // 长驻共享服务(不像其它四个按 model 分桶各起一份),必须 "run" 级共享接收器。
    scope: "run",
    env: (endpoint) => ({
      // OTLPTraceExporter() 自己拼 /v1/traces 尾巴(见 origin src/backend/otel.ts),这里传 base。
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint.replace(/\/v1\/traces$/, ""),
      // 标准 OTel SDK 环境变量:otel.ts 用的 BatchSpanProcessor 默认调度延迟几秒,和"这一轮
      // 请求几时返回"这两条时间线天生对不齐(同 examples/zh/tier1/langgraph 复现过的问题,
      // 见 memory/langsmith-dialect-langchain-completion-shape-gap.md),调小延迟 + send()
      // 里补一段收尾宽限时间(见 OTEL_FLUSH_GRACE_MS)双管齐下。
      OTEL_BSP_SCHEDULE_DELAY: "200",
    }),
  },
  send,
});
