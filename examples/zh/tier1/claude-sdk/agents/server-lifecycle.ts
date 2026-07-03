// 把 ../src/backend/server.ts 当外部黑盒服务管起来:eval 侧不 import 应用代码,只按它监听的
// 端口 + /healthz 契约把它当子进程拉起——应用源码全程不知道 niceeval 的存在。
//
// agent.ts 里的 MODEL 只在模块加载时读一次 AGENT_MODEL,不支持按请求切换,所以模型对比不能
// 共用一个 server:按 model 分桶,每个 model 各自的实例各拉各的进程、各挑各的空闲端口。
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";

const APP_DIR = new URL("..", import.meta.url).pathname;

export interface ServerHandle {
  readonly baseUrl: string;
}

interface Instance {
  readonly child: ChildProcess;
  readonly baseUrl: string;
  readonly ready: Promise<ServerHandle>;
}

const instances = new Map<string, Instance>();

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address && typeof address === "object") {
        const port = address.port;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error("拿不到空闲端口")));
      }
    });
  });
}

export interface EnsureServerOptions {
  /** 未指定时用应用 .env 里的默认模型(不注入 AGENT_MODEL,分桶 key 用 "default")。 */
  readonly model?: string;
}

/**
 * 首次(按 model 分桶)调用时拉起子进程,轮询 /healthz 直到就绪;同一 model 的后续调用直接
 * 复用同一个实例。claude-sdk 的会话历史落在 SDK 自己的 ~/.claude(resume 找回),不像
 * pi-sdk 那样存进程内存,所以这里重启这个 model 的实例不会丢会话——但仍按 model 分桶复用,
 * 避免同一 model 重复 spawn。
 */
export async function ensureServer(options: EnsureServerOptions = {}): Promise<ServerHandle> {
  const key = options.model ?? "default";
  const existing = instances.get(key);
  if (existing) return existing.ready;

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
  if (options.model) env.AGENT_MODEL = options.model;

  const child = spawn("node", ["--env-file", ".env", "--import", "tsx/esm", "src/backend/server.ts"], {
    cwd: APP_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.on("exit", () => {
    instances.delete(key);
  });

  const ready: Promise<ServerHandle> = (async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl}/healthz`);
        if (res.ok) return { baseUrl };
      } catch {
        // 应用还没监听端口,继续轮询。
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(
      `claude-sdk server(model=${key})在 30s 内未就绪:${baseUrl}/healthz。子进程 stderr:\n${stderr}`,
    );
  })();

  instances.set(key, { child, baseUrl, ready });
  return ready;
}

function shutdownAll(): void {
  for (const { child } of instances.values()) child.kill();
  instances.clear();
}
process.on("exit", shutdownAll);
process.on("SIGINT", () => {
  shutdownAll();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdownAll();
  process.exit(143);
});
