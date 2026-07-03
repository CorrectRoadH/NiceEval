// niceeval adapter for the codex-sdk example app. Non-invasive: the app's own
// server.ts / agent.ts are untouched — this file spawns the app's real HTTP
// server as a child process and drives it over `POST /api/chat`, same as any
// deployed-agent adapter (see docs-site/guides/remote-agent.mdx).
import { spawn, type ChildProcess } from "node:child_process";
import { defineAgent } from "niceeval/adapter";
import type { JsonValue, StreamEvent } from "niceeval";

const PORT = 5199;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | undefined;
let readyPromise: Promise<void> | undefined;

async function isUp(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/healthz`)).ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<void> {
  if (await isUp()) return;
  readyPromise ??= (async () => {
    // cwd must be the directory containing package.json (the parent of this
    // agents/ directory); server.ts itself now lives under src/backend/.
    child = spawn("node", ["--env-file", ".env", "--import", "tsx/esm", "src/backend/server.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: "inherit",
    });
    process.on("exit", () => child?.kill());
    const deadline = Date.now() + 20_000; // Codex turns can be slow to cold-start
    while (Date.now() < deadline) {
      if (await isUp()) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`codex-sdk server did not become healthy within 20s at ${BASE_URL}/healthz`);
  })();
  return readyPromise;
}

// Shape of `POST /api/chat`'s response — see server.ts / agent.ts in this
// same directory (app.route() and runTurn()).
interface ChatToolCall {
  name: string;
  input: unknown;
  output: unknown;
}

interface ChatResponse {
  sessionId: string;
  reply: string;
  toolCalls: ChatToolCall[];
}

// Codex's own action taxonomy (command_execution / file_change / mcp:*
// / web_search / todo_list / error, from agent.ts's mapThreadItemsToToolCalls)
// isn't niceeval's canonical ToolName vocabulary, so we leave `tool` unset —
// deriveRunFacts falls back to "unknown" for `tc.name` but still keeps the
// original string on `tc.originalName`, which is what t.calledTool(...) also
// matches against (see src/scoring/scoped.ts's toolMatches).
//
// "error" items are *not* modeled as an action.called/result pair: through the
// s2a proxy this app talks to, Codex commonly reports a recoverable
// "Falling back from WebSockets to HTTPS transport" notice mid-turn — the
// turn still completes normally afterward. Standard `StreamEvent` already has
// a dedicated `{ type: "error", message }` case for exactly this ("a
// non-fatal error the agent reported"), so route it there instead of
// polluting `t.calledTool` / `t.noFailedActions` with a transport hiccup that
// isn't a real tool failure.
function toStreamEvents(body: ChatResponse): StreamEvent[] {
  const events: StreamEvent[] = [];
  body.toolCalls.forEach((call, i) => {
    if (call.name === "error") {
      const output = call.output as { message?: string } | null | undefined;
      events.push({ type: "error", message: output?.message ?? "Codex reported an error." });
      return;
    }
    const callId = `${call.name}-${i}`;
    events.push({ type: "action.called", callId, name: call.name, input: call.input as JsonValue });
    events.push({
      type: "action.result",
      callId,
      output: call.output as JsonValue,
      status: toolStatus(call),
    });
  });
  events.push({ type: "message", role: "assistant", text: body.reply });
  return events;
}

// command_execution / file_change / mcp:* all carry a `status` field inside
// their `output` object (see agent.ts's mapThreadItemsToToolCalls).
function toolStatus(call: ChatToolCall): "completed" | "failed" | "rejected" {
  const output = call.output as { status?: string } | null | undefined;
  return output?.status === "failed" ? "failed" : "completed";
}

export default defineAgent({
  name: "codex-sdk",
  capabilities: { conversation: true, toolObservability: true },

  async send(input, ctx) {
    await ensureServer();

    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: input.text, sessionId: ctx.session.id }),
      signal: ctx.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        status: "failed" as const,
        events: [{ type: "error" as const, message: `codex-sdk server returned HTTP ${response.status}${text ? `: ${text}` : ""}` }],
      };
    }

    const body = (await response.json()) as ChatResponse;
    ctx.session.id = body.sessionId;

    return {
      events: toStreamEvents(body),
      data: { reply: body.reply },
      status: "completed" as const,
    };
  },
});
