// node:http 服务器：负责 HTTP 层和"pi AgentEvent → AI SDK UIMessageChunk"的协议翻译。
// 真实的 pi Agent 搭建在 agent.ts,两个工具的实现在 tools.ts。
//
// /api/chat 用 createUIMessageStream 手写 execute(),边订阅 Agent 的事件边把它们翻译成
// UIMessageChunk 写进 writer——不是套 AI SDK 的 streamText(这里的模型调用完全是 pi 在
// 驱动),所以用不了 toUIMessageStream(那是从 streamText 的结果转换)。
//
// HITL:calculate 工具的审批走进程内的 pendingApprovals 这个 Map<toolCallId, resolve>。
// beforeToolCall 命中 calculate 时,先把 tool-approval-request 写进当前这条(还开着的)
// SSE 流,再 await 一个 Promise 卡住 pi 的 tool 执行;POST /api/chat/approve 用
// toolUseId 查到对应的 resolve 函数并调用,原来那条 /api/chat 请求的流才会继续往下走。
// 这里不模拟 AI SDK 官方"断流、客户端重发"的 resume 协议——连接全程保持打开,更简单。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createUIMessageStream, pipeUIMessageStreamToResponse } from "ai";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createAgent } from "./agent.ts";

const port = Number(process.env.PORT ?? 5299);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`pi-sdk example listening on http://127.0.0.1:${port}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// toolCallId -> resolve(approved)。POST /api/chat/approve 解析这个 Map。
const pendingApprovals = new Map<string, (approved: boolean) => void>();

// sessionId -> 上一轮结束时的完整对话记录(agent.state.messages)。pi 的 Agent
// 没有 Codex thread / Claude session 那种落盘 resume 机制，所以由服务端在内存里
// 保存历史；前端从 start chunk 的 messageMetadata 里拿 sessionId，下一轮随请求
// 带回来。不存就是每轮从零开始——上一轮问过的"哪个城市"这类上下文会全部丢失。
const sessions = new Map<string, AgentMessage[]>();

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url === "/api/chat") {
    const body = (await readJson(req)) as { message?: unknown; sessionId?: unknown };
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      throw new Error("body.message must be a non-empty string.");
    }
    const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : randomUUID();
    await streamChat(req, res, body.message, sessionId);
    return;
  }

  if (req.method === "POST" && url === "/api/chat/approve") {
    const body = (await readJson(req)) as { toolUseId?: unknown; approved?: unknown };
    if (typeof body.toolUseId !== "string" || typeof body.approved !== "boolean") {
      throw new Error("body must be { toolUseId: string, approved: boolean }.");
    }
    const resolve = pendingApprovals.get(body.toolUseId);
    if (!resolve) {
      json(res, 404, { error: `no pending approval for toolUseId ${body.toolUseId}` });
      return;
    }
    pendingApprovals.delete(body.toolUseId);
    resolve(body.approved);
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: "not found" });
}

async function streamChat(
  req: IncomingMessage,
  res: ServerResponse,
  message: string,
  sessionId: string,
): Promise<void> {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageMetadata: { sessionId } });

      // calculate 被用户拒绝的 toolCallId——tool_execution_end 到达时用它区分
      // "被 HITL 拒绝"(tool-output-denied)和"真的执行出错"(tool-output-error)。
      const deniedToolCalls = new Set<string>();
      // AssistantMessageEvent 的 contentIndex 每个 turn 都从 0 重新数，拼上 turn 序号
      // 才能保证同一次回复里多轮文本用到的 text-start/delta/end id 不撞车。
      let turnIndex = -1;

      const agent = createAgent({
        messages: sessions.get(sessionId),
        beforeToolCall: async ({ toolCall }) => {
          if (toolCall.name !== "calculate") return undefined;
          writer.write({ type: "tool-approval-request", approvalId: toolCall.id, toolCallId: toolCall.id });
          const approved = await new Promise<boolean>((resolve) => {
            pendingApprovals.set(toolCall.id, resolve);
          });
          if (!approved) {
            deniedToolCalls.add(toolCall.id);
            return { block: true, reason: "用户拒绝了这次调用" };
          }
          return undefined;
        },
      });

      req.on("close", () => agent.abort());

      const unsubscribe = agent.subscribe((event: AgentEvent) => {
        switch (event.type) {
          case "turn_start": {
            turnIndex += 1;
            break;
          }
          case "message_update": {
            const e = event.assistantMessageEvent;
            const id = `t${turnIndex}-${"contentIndex" in e ? e.contentIndex : 0}`;
            if (e.type === "text_start") writer.write({ type: "text-start", id });
            else if (e.type === "text_delta") writer.write({ type: "text-delta", id, delta: e.delta });
            else if (e.type === "text_end") writer.write({ type: "text-end", id });
            break;
          }
          case "tool_execution_start": {
            writer.write({
              type: "tool-input-available",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.args,
            });
            break;
          }
          case "tool_execution_end": {
            if (deniedToolCalls.has(event.toolCallId)) {
              deniedToolCalls.delete(event.toolCallId);
              writer.write({ type: "tool-output-denied", toolCallId: event.toolCallId });
            } else if (event.isError) {
              writer.write({
                type: "tool-output-error",
                toolCallId: event.toolCallId,
                errorText: extractErrorText(event.result),
              });
            } else {
              writer.write({
                type: "tool-output-available",
                toolCallId: event.toolCallId,
                output: event.result?.details ?? event.result?.content,
              });
            }
            break;
          }
          default:
            break;
        }
      });

      try {
        await agent.prompt(message);
        await agent.waitForIdle();
        if (agent.state.errorMessage) {
          writer.write({ type: "error", errorText: agent.state.errorMessage });
        }
        // 这一轮跑完(含工具调用和最终回答)后把完整 transcript 存回去，下一轮续接。
        sessions.set(sessionId, agent.state.messages);
      } catch (error) {
        writer.write({ type: "error", errorText: error instanceof Error ? error.message : String(error) });
      } finally {
        unsubscribe();
      }

      writer.write({ type: "finish" });
    },
  });

  pipeUIMessageStreamToResponse({ response: res, stream });
}

interface ToolResultLike {
  content?: Array<{ type: string; text?: string }>;
  details?: unknown;
}

function extractErrorText(result: ToolResultLike | undefined): string {
  const textBlock = result?.content?.find((c) => c.type === "text" && typeof c.text === "string");
  return textBlock?.text ?? "工具执行失败";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
