// 真调用 Codex SDK(`@openai/codex-sdk`)——没有 mock 模式,这个示例的意义就是
// 演示真实的 Codex agent 长什么样。见 README.md「为什么任务形状长这样」。
//
// 用的是 SDK 自己推荐的流式接口:`thread.runStreamed()` 返回 ThreadEvent 的
// AsyncGenerator(thread.started / turn.started / item.* / turn.completed /
// turn.failed / error),SDK 官方示例(samples/basic_streaming.ts)就是拿这个
// 事件循环驱动 UI 的。server.ts 把事件原样透传成 SSE,前端按 event.type 渲染。
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Codex, type Thread, type ThreadEvent } from "@openai/codex-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Codex 是"目录里的编码 agent":给它一个 scratch 工作目录去读写文件、跑命令,
// 别让它碰仓库本体。见 README.md「为什么任务形状长这样」。
export const WORKSPACE_DIR = path.join(__dirname, "workspace");

// 走 s2a 这个 OpenAI 兼容代理(Responses API),而不是官方 OpenAI 端点——
// baseUrl 直接映射成 CLI 的 `openai_base_url` config,apiKey 映射成
// env.CODEX_API_KEY,详见 node_modules/@openai/codex-sdk/dist/index.js。
const codex = new Codex({ apiKey: process.env.CODEX_API_KEY, baseUrl: process.env.CODEX_BASE_URL });

// 会话续接用 Codex 原生机制:thread 落盘在 ~/.codex/sessions,前端从
// `thread.started` 事件里拿 thread_id 自己保存,下一轮随请求带回来,这里用
// codex.resumeThread(threadId) 接回去——服务端不需要任何会话状态。
export async function runTurnStreamed(
  message: string,
  threadId: string | undefined,
  signal: AbortSignal,
): Promise<AsyncGenerator<ThreadEvent>> {
  await mkdir(WORKSPACE_DIR, { recursive: true });

  const threadOptions = {
    workingDirectory: WORKSPACE_DIR,
    skipGitRepoCheck: true,
    model: process.env.AGENT_MODEL ?? "gpt-5.4",
  };
  const thread: Thread = threadId
    ? codex.resumeThread(threadId, threadOptions)
    : codex.startThread(threadOptions);

  const { events } = await thread.runStreamed(message, { signal });
  return events;
}
