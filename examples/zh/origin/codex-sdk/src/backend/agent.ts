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
import { Codex, type CodexOptions, type Thread, type ThreadEvent } from "@openai/codex-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Codex 是"目录里的编码 agent":给它一个 scratch 工作目录去读写文件、跑命令,
// 别让它碰仓库本体。见 README.md「为什么任务形状长这样」。workspace/ 是运行时
// 生成的 scratch 数据,故意留在项目根(而不是 src/backend/ 里),__dirname 是
// src/backend,得往上两级才能回到项目根。
export const WORKSPACE_DIR = path.join(__dirname, "..", "..", "workspace");

// 走 s2a 这个 OpenAI 兼容代理(Responses API),而不是官方 OpenAI 端点。
// apiKey 映射成 env.CODEX_API_KEY,详见 node_modules/@openai/codex-sdk/dist/index.js。
//
// Codex CLI 默认对支持的模型走 WebSocket 流式传输(model 元数据里的
// prefer_websockets),但 s2a 代理不支持 WS upgrade,导致每轮都要
// "Reconnecting... N/5" 重试几次才 fallback 回 HTTPS,页面上一堆刷屏错误。
// 本想直接 `model_providers.openai.supports_websockets = false`,但内置
// "openai" provider id 是保留字,CLI 会拒绝("Built-in providers cannot
// be overridden")。所以照官方报错建议,自己定义一个同价的 provider
// (换个 id),显式 supports_websockets: false,再用 model_provider 选中它。
// 不能再用 CodexOptions.baseUrl(那只是给内置 openai provider 打补丁的
// 语法糖),base_url 改到这个自定义 provider 里配。
const CODEX_BASE_URL = process.env.CODEX_BASE_URL ?? "https://api.openai.com/v1";

// 可选的 OTel 接入:Codex CLI 原生支持 `otel` 配置段(trace_exporter /
// metrics_exporter,exporter 种类有 none / otlp-http / otlp-grpc),导出发生在
// codex 子进程内部,应用侧零埋点。设了 OTEL_EXPORTER_OTLP_ENDPOINT 才开启。
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const otelConfig: NonNullable<CodexOptions["config"]> = OTLP_ENDPOINT
  ? {
      otel: {
        environment: "dev",
        trace_exporter: {
          "otlp-http": { endpoint: `${OTLP_ENDPOINT}/v1/traces`, protocol: "json" },
        },
      },
    }
  : {};

const codex = new Codex({
  apiKey: process.env.CODEX_API_KEY,
  config: {
    model_providers: {
      "openai-no-ws": {
        name: "openai-no-ws",
        base_url: CODEX_BASE_URL,
        env_key: "CODEX_API_KEY",
        wire_api: "responses",
        supports_websockets: false,
      },
    },
    model_provider: "openai-no-ws",
    ...otelConfig,
  },
});

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
