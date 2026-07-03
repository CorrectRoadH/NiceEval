// 把 ../src/backend/server.ts 当外部黑盒服务管起来:eval 侧不 import 应用代码,只按它监听的
// 端口 + /healthz 契约把它当子进程拉起——应用源码全程不知道 niceeval 的存在。
//
// 和其它四个示例不同:这里不用按 model 分桶。model 走请求体(ai-sdk-runtime.ts 的
// `resolveModel(modelId ?? ...)` 每次请求都重新解析),不是启动时读一次的环境变量,所以
// 一个 server 实例就能服务所有 model——compare-models 的多个 experiment 共享同一个进程。
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

let instance: Instance | undefined;

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
  /** ctx.telemetry?.env——tracing 声明了 scope:"run",整个 run 只需要注入一次。 */
  readonly telemetryEnv?: Readonly<Record<string, string>>;
}

export async function ensureServer(options: EnsureServerOptions = {}): Promise<ServerHandle> {
  if (instance) return instance.ready;

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), ...options.telemetryEnv };

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
    instance = undefined;
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
    throw new Error(`ai-sdk-v7 server 在 30s 内未就绪:${baseUrl}/healthz。子进程 stderr:\n${stderr}`);
  })();

  instance = { child, baseUrl, ready };
  return ready;
}

function shutdownAll(): void {
  instance?.child.kill();
  instance = undefined;
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
