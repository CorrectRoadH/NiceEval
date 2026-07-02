// 一个 node:http 服务器,演示怎么用 OpenAI 的 Codex TypeScript SDK
// (`@openai/codex-sdk`)搭一个 agent 后端。纯 demo,不依赖 niceeval。见 README.md。
// HTTP 层只负责路由和 SSE 编帧,真正的 Codex 调用在 agent.ts。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTurnStreamed } from "./agent.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 5189 被 examples/zh/origin/claude-agent-sdk 占了(两个示例默认端口曾撞车),这里改用 5199。
const PORT = Number(process.env.PORT ?? 5199);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  process.stdout.write(`codex-sdk example listening on http://localhost:${PORT}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url === "/") {
    const html = await readFile(path.join(__dirname, "public/index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && url === "/api/chat") {
    const body = await readJson(req);
    const { message, threadId } = parseChatRequest(body);
    await streamTurn(req, res, message, threadId);
    return;
  }

  json(res, 404, { error: `not found: ${req.method} ${url}` });
}

// SSE:把 Codex SDK 的 ThreadEvent 原样一帧一帧转发给浏览器。事件本身就是
// SDK 的公开协议(thread.started 带 thread_id,item.* 带 ThreadItem,
// turn.completed 带 usage),不再自己发明 {reply, toolCalls} 的中间格式。
async function streamTurn(
  req: IncomingMessage,
  res: ServerResponse,
  message: string,
  threadId: string | undefined,
): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  // 浏览器断开(关页面/中断)就取消这一轮 turn,别让 Codex 子进程白跑。
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const events = await runTurnStreamed(message, threadId, abort.signal);
    for await (const event of events) send(event);
  } catch (error) {
    if (!abort.signal.aborted) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  res.end();
}

function parseChatRequest(value: unknown): { message: string; threadId?: string } {
  if (typeof value !== "object" || value === null) throw new Error("JSON body is required.");
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string" || record.message.trim().length === 0) {
    throw new Error("message must be a non-empty string.");
  }
  return {
    message: record.message,
    threadId: typeof record.threadId === "string" && record.threadId.length > 0 ? record.threadId : undefined,
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
