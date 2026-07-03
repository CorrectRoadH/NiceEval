// niceeval 侧的适配器 —— 应用代码(server.ts / agent.ts / tools.ts / tracing.ts)完全不知道
// niceeval 的存在,这里是唯一接线的地方。
//
// 被测应用是本目录自带的 node:http 服务 + 手写 tool-calling 循环,单轮(server.ts 里
// POST /api/chat 只把 body.message 传给 runAgent,body.sessionId 读出来但从未被使用 ——
// 所以这里不声明 capabilities.conversation,免得 t.reply / t.newSession 这类断言看起来
// 能用、实际上每次都是全新会话,负断言会不可信)。
// 注:这个应用原本对应 examples/zh/origin/custom-genai,那个目录已改名/重写为
// examples/zh/origin/pi-sdk,不再是这里的 before 基线,配对待重做。
//
// send() 里把服务当子进程起来(懒启动、只起一次、跨 eval 复用同一个实例),再对
// POST /api/chat 发 fetch,把 { reply, toolCalls } 映射成标准 StreamEvent[]。
import { spawn, type ChildProcess } from "node:child_process";
import { defineAgent } from "niceeval/adapter";
import type { JsonValue, StreamEvent } from "niceeval";

const PORT = 5299;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// 应用目录(agents/ 的上一级,server.ts 所在处)—— child_process 的 cwd 必须落在这里,
// 否则 --env-file .env 和 tsx 解析 server.ts 里的相对 import 都会找错地方。
const APP_DIR = new URL("..", import.meta.url).pathname;

interface ToolCallRecord {
  name: string;
  input: unknown;
  output: unknown;
}

interface ChatResponse {
  reply: string;
  toolCalls: ToolCallRecord[];
}

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
    child = spawn("node", ["--env-file", ".env", "--import", "tsx/esm", "server.ts"], {
      cwd: APP_DIR,
      stdio: "inherit",
    });
    process.on("exit", () => child?.kill());

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await isUp()) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`custom-genai server did not become healthy within 15s at ${BASE_URL}/healthz`);
  })();
  return readyPromise;
}

/** { reply, toolCalls } → niceeval 的标准事件流:每个 toolCall 拆成 action.called + action.result 对。 */
function toStreamEvents(body: ChatResponse): StreamEvent[] {
  const events: StreamEvent[] = [];
  body.toolCalls.forEach((call, i) => {
    const callId = `call-${i}`;
    events.push({ type: "action.called", callId, name: call.name, input: call.input as JsonValue });
    events.push({ type: "action.result", callId, output: call.output as JsonValue, status: "completed" });
  });
  events.push({ type: "message", role: "assistant", text: body.reply });
  return events;
}

function failedTurn(message: string) {
  return {
    status: "failed" as const,
    events: [{ type: "error" as const, message }],
  };
}

export default defineAgent({
  name: "custom-genai",
  // 手写工具循环没有 toolCalls 之外的可观测数据,也没有多轮会话(见文件顶部说明)——
  // 只声明 toolObservability,不声明 conversation。
  capabilities: { toolObservability: true },

  async send(input, ctx) {
    try {
      await ensureServer();

      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: input.text }),
        signal: ctx.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return failedTurn(`custom-genai server 返回 HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`);
      }

      const body = (await response.json()) as ChatResponse;

      return {
        events: toStreamEvents(body),
        data: body,
        status: "completed" as const,
      };
    } catch (error) {
      return failedTurn(error instanceof Error ? error.message : String(error));
    }
  },
});
