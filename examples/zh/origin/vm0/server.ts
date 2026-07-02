// 一个 node:http 服务器,演示用 vm0(github.com/vm0-ai/vm0)搭一个 agent 后端。
// 纯 demo,不依赖 niceeval。
//
// vm0 是托管的 agent 运行时:agent 用 vm0.yaml(agent compose)声明、跑在平台的
// Firecracker microVM 沙箱里,没有可 import 的 npm SDK——但有公开、版本化的 JSON
// REST 契约(仓库 turbo/packages/api-contracts/,官方 CLI `@vm0/cli` 就是这套
// 契约的薄客户端),`vm0 auth setup-token` 就是官方给 CI/程序化调用发 token 的
// 通道。所以"接 vm0 的最佳实践"就是:
//   1. `vm0 compose vm0.yaml` 部署本目录的 agent compose(一次性,见 README.md);
//   2. 后端拿 VM0_TOKEN 打 `POST /api/agent/runs` 创建 run(首轮带 agentComposeId,
//      续轮带 sessionId 接同一会话),再轮询 `GET /api/agent/runs/:id/events`;
//   3. eventData 就是沙箱里 claude-code 的原始 stream-JSON 事件(assistant 文本 /
//      tool_use / tool_result / result),原样经 SSE 转发给前端按类型渲染。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5588);

// 和官方 CLI 相同的取值顺序/默认值:token 先 ZERO_TOKEN 再 VM0_TOKEN,
// API 地址 VM0_API_URL,默认 https://www.vm0.ai。
const API_BASE = (process.env.VM0_API_URL ?? "https://www.vm0.ai").replace(/\/$/, "");
const TOKEN = process.env.ZERO_TOKEN ?? process.env.VM0_TOKEN;
const AGENT_NAME = process.env.VM0_AGENT_NAME ?? "niceeval-demo";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "timeout", "cancelled"]);
const POLL_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// vm0 REST 客户端(契约见 vm0 仓库 turbo/packages/api-contracts/src/contracts/)。
// ---------------------------------------------------------------------------

async function vm0Api<T>(pathname: string, init?: RequestInit): Promise<T> {
  if (!TOKEN) {
    throw new Error(
      "缺少 VM0_TOKEN:先 `vm0 auth login`,再用 `vm0 auth setup-token` 生成程序化调用的 token 填进 .env。",
    );
  }
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    // 错误统一是 { error: { message, code } }(apiErrorSchema)。
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: { message?: string } }).error?.message ?? JSON.stringify(body))
        : `HTTP ${res.status}`;
    throw new Error(`vm0 API ${pathname} 失败(${res.status}):${message}`);
  }
  return body as T;
}

// agent 名字 -> compose id 的解析和官方 CLI 一致:GET /api/agent/composes?name=,
// 404 说明还没部署过这个名字的 compose。进程内缓存一次即可。
let cachedComposeId: string | undefined;
async function resolveComposeId(): Promise<string> {
  if (cachedComposeId) return cachedComposeId;
  try {
    const compose = await vm0Api<{ id: string; name: string }>(
      `/api/agent/composes?name=${encodeURIComponent(AGENT_NAME)}`,
    );
    cachedComposeId = compose.id;
    return compose.id;
  } catch (error) {
    throw new Error(
      `找不到名为 "${AGENT_NAME}" 的 agent compose——先在本目录跑 \`vm0 compose vm0.yaml\` 部署它。` +
        `(原始错误:${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

// 沙箱里 claude-code 的模型凭证按 vm0 的机制走 run secrets 注入(`vm0 init` 的
// 官方示例就是 `--secrets CLAUDE_CODE_OAUTH_TOKEN=...`)。平台只存 secret 名字
// 不存值,所以续轮也要重传(官方 CLI `vm0 run continue` 同样如此)。
function collectRunSecrets(): Record<string, string> | undefined {
  const secrets: Record<string, string> = {};
  for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]) {
    const value = process.env[name];
    if (value) secrets[name] = value;
  }
  return Object.keys(secrets).length > 0 ? secrets : undefined;
}

type CreateRunResponse = {
  runId: string;
  status: string;
  sessionId: string;
  sandboxId?: string;
  error?: string;
};

type EventsResponse = {
  events: Array<{ sequenceNumber: number; eventType: string; eventData: unknown; createdAt: string }>;
  hasMore: boolean;
  nextSequence: number;
  run: { status: string; error?: string; lastEventSequence?: number };
  framework: string;
};

async function createRun(message: string, sessionId: string | undefined): Promise<CreateRunResponse> {
  const secrets = collectRunSecrets();
  const body = sessionId
    ? { sessionId, prompt: message, ...(secrets ? { secrets } : {}) }
    : { agentComposeId: await resolveComposeId(), prompt: message, ...(secrets ? { secrets } : {}) };
  return vm0Api<CreateRunResponse>("/api/agent/runs", { method: "POST", body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// HTTP 服务器:GET /healthz、GET /、POST /api/chat(SSE)。
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  process.stdout.write(`vm0 example listening on http://localhost:${PORT} (agent=${AGENT_NAME}, api=${API_BASE})\n`);
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
    const { message, sessionId } = parseChatRequest(body);
    await streamRun(req, res, message, sessionId);
    return;
  }

  json(res, 404, { error: `not found: ${req.method} ${url}` });
}

// SSE:创建 run 后轮询事件、把 eventData(claude-code stream-JSON)原样逐帧转发。
// 额外只加两个带 vm0. 前缀的信封帧:run 创建(带 sessionId,前端存起来续会话)
// 和 run 结束(带终态)。
async function streamRun(
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
  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
  });

  let run: CreateRunResponse;
  try {
    run = await createRun(message, sessionId);
  } catch (error) {
    send({ type: "vm0.error", message: error instanceof Error ? error.message : String(error) });
    res.end();
    return;
  }
  send({ type: "vm0.run.created", runId: run.runId, sessionId: run.sessionId, status: run.status });

  try {
    let since = -1;
    for (;;) {
      if (clientGone) {
        // 浏览器断开就取消 run,别让沙箱白跑。
        await vm0Api(`/api/agent/runs/${run.runId}/cancel`, { method: "POST", body: "{}" }).catch(() => {});
        return;
      }
      const page = await vm0Api<EventsResponse>(`/api/agent/runs/${run.runId}/events?since=${since}&limit=100`);
      for (const event of page.events) send(event.eventData);
      since = page.nextSequence;

      if (TERMINAL_RUN_STATUSES.has(page.run.status) && !page.hasMore) {
        send({ type: "vm0.run.finished", status: page.run.status, error: page.run.error });
        break;
      }
      if (!page.hasMore) await sleep(POLL_INTERVAL_MS);
    }
  } catch (error) {
    if (!clientGone) {
      send({ type: "vm0.error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  res.end();
}

function parseChatRequest(value: unknown): { message: string; sessionId?: string } {
  if (typeof value !== "object" || value === null) throw new Error("JSON body is required.");
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string" || record.message.trim().length === 0) {
    throw new Error("message must be a non-empty string.");
  }
  return {
    message: record.message,
    sessionId:
      typeof record.sessionId === "string" && record.sessionId.length > 0 ? record.sessionId : undefined,
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
