// 一个 node:http 服务器,演示怎么用 OpenAI 的 Codex TypeScript SDK
// (`@openai/codex-sdk`)搭一个 agent 后端。纯 demo,不依赖 niceeval。见 README.md。
// HTTP 层只负责路由,真正的 Codex 调用在 agent.ts。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "./agent.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 5189 被 examples/zh/origin/claude-sdk 占了(两个示例默认端口曾撞车),这里改用 5199。
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
    const html = await readFile(path.join(__dirname, "..", "frontend", "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && url === "/api/chat") {
    const body = await readJson(req);
    const { message, sessionId } = parseChatRequest(body);
    const resolvedSessionId = sessionId ?? randomUUID();
    const response = await runTurn(resolvedSessionId, message);
    json(res, 200, { sessionId: resolvedSessionId, ...response });
    return;
  }

  json(res, 404, { error: `not found: ${req.method} ${url}` });
}

function parseChatRequest(value: unknown): { message: string; sessionId?: string } {
  if (typeof value !== "object" || value === null) throw new Error("JSON body is required.");
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string" || record.message.trim().length === 0) {
    throw new Error("message must be a non-empty string.");
  }
  return {
    message: record.message,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
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
