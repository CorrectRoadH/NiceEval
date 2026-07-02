// 一个用 Claude Agent SDK(@anthropic-ai/claude-agent-sdk)搭的最小 agent 后端。
// 独立示例项目,不 import niceeval,不是 niceeval adapter —— 详见 README.md。
//
// 前后端接口按 SDK 官方 hosting 指南/cookbook 的形状:POST 一条消息,响应是
// SSE 流,每帧 data: 是一个序列化的 SDKMessage(system/stream_event/assistant/
// user/result)——不把消息流折叠成自造的 {reply, toolCalls} JSON。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "./agent.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5189);

// ---------------------------------------------------------------------------
// HTTP 服务器 —— 无框架,原生 node:http。
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`claude-agent-sdk 示例服务已启动: http://127.0.0.1:${PORT}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET" && req.url === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = await readFile(path.join(__dirname, "public", "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    const body = await readJson(req);
    const { message, sessionId } = parseChatRequest(body);
    await streamTurn(req, res, message, sessionId);
    return;
  }

  json(res, 404, { error: `not found: ${req.method} ${req.url}` });
}

// SSE:把 query() 产出的每个 SDKMessage 原样序列化转发。session_id 就在消息
// 里(system/init 与 result 都带),前端自己存、下一轮带回来 resume。
async function streamTurn(
  req: IncomingMessage,
  res: ServerResponse,
  message: string,
  sessionId: string | undefined,
): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
  });

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const turn = runTurn(message, sessionId);
  try {
    for await (const sdkMessage of turn) {
      if (clientGone) {
        // 浏览器已断开:中断这轮 agent,别让子进程白跑。
        await turn.interrupt().catch(() => {});
        break;
      }
      send(sdkMessage);
    }
  } catch (error) {
    if (!clientGone) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  res.end();
}

function parseChatRequest(value: unknown): { message: string; sessionId?: string } {
  if (typeof value !== "object" || value === null) {
    throw new Error("JSON body is required.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string" || record.message.trim().length === 0) {
    throw new Error("message must be a non-empty string.");
  }
  return {
    message: record.message,
    sessionId:
      typeof record.sessionId === "string" && record.sessionId.trim().length > 0
        ? record.sessionId
        : undefined,
  };
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
