// 真调用 Codex SDK(`@openai/codex-sdk`)——没有 mock 模式,这个示例的意义就是
// 演示真实的 Codex agent 长什么样。见 README.md「为什么任务形状长这样」。
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Codex, Thread, type ThreadItem } from "@openai/codex-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Codex 是"目录里的编码 agent":给它一个 scratch 工作目录去读写文件、跑命令,
// 别让它碰仓库本体。见 README.md「为什么任务形状长这样」。workspace/ 是运行时
// 生成的 scratch 数据,故意留在项目根(而不是 src/backend/ 里),__dirname 是
// src/backend,得往上两级才能回到项目根。
export const WORKSPACE_DIR = path.join(__dirname, "..", "..", "workspace");

export type ToolCall = { name: string; input: unknown; output: unknown };
export type ChatResponse = { reply: string; toolCalls: ToolCall[] };

// 走 s2a 这个 OpenAI 兼容代理(Responses API),而不是官方 OpenAI 端点——
// baseUrl 直接映射成 CLI 的 `openai_base_url` config,apiKey 映射成
// env.CODEX_API_KEY,详见 node_modules/@openai/codex-sdk/dist/index.js。
const codex = new Codex({ apiKey: process.env.CODEX_API_KEY, baseUrl: process.env.CODEX_BASE_URL });

// sessionId -> Codex 的 thread id。SDK 把 thread 落盘在 ~/.codex/sessions,
// 我们这里只需要存 id,下一轮用 codex.resumeThread(id) 接回去就行——不用自己
// 存对话历史。见已安装包里的 node_modules/@openai/codex-sdk/README.md
// "Resuming an existing thread"。
const aiThreadIds = new Map<string, string>();

export async function runTurn(sessionId: string, message: string): Promise<ChatResponse> {
  await mkdir(WORKSPACE_DIR, { recursive: true });

  const threadOptions = {
    workingDirectory: WORKSPACE_DIR,
    skipGitRepoCheck: true,
    model: process.env.AGENT_MODEL ?? "gpt-5.4",
  };
  const existingThreadId = aiThreadIds.get(sessionId);
  const thread: Thread = existingThreadId
    ? codex.resumeThread(existingThreadId, threadOptions)
    : codex.startThread(threadOptions);

  const turn = await thread.run(message);
  if (thread.id) aiThreadIds.set(sessionId, thread.id);

  return {
    reply: turn.finalResponse || "(Codex 这轮没有生成文本回复,只有下面的工具调用。)",
    toolCalls: mapThreadItemsToToolCalls(turn.items),
  };
}

// Codex 的 ThreadItem 是个封闭 union(command_execution / file_change /
// mcp_tool_call / web_search / todo_list / agent_message / reasoning / error)。
// 这里把"动作类" item 映射成 {name, input, output};agent_message 就是最终
// 回复本身(已经进了 turn.finalResponse),reasoning 是内部思考摘要,两者都不是
// "工具调用",不重复塞进 toolCalls。
export function mapThreadItemsToToolCalls(items: ThreadItem[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const item of items) {
    switch (item.type) {
      case "command_execution":
        calls.push({
          name: "command_execution",
          input: { command: item.command },
          output: { status: item.status, exitCode: item.exit_code ?? null, output: item.aggregated_output },
        });
        break;
      case "file_change":
        calls.push({
          name: "file_change",
          input: { changes: item.changes },
          output: { status: item.status },
        });
        break;
      case "mcp_tool_call":
        calls.push({
          name: `mcp:${item.server}.${item.tool}`,
          input: item.arguments,
          output: item.error ? { error: item.error.message } : (item.result ?? null),
        });
        break;
      case "web_search":
        calls.push({ name: "web_search", input: { query: item.query }, output: null });
        break;
      case "todo_list":
        calls.push({ name: "todo_list", input: {}, output: { items: item.items } });
        break;
      case "error":
        calls.push({ name: "error", input: {}, output: { message: item.message } });
        break;
      default:
        break;
    }
  }
  return calls;
}
