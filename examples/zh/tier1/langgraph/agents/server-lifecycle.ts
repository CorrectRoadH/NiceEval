// 把 ../src/backend/server.py 当外部黑盒服务管起来:eval 侧不 import 应用代码,只按它监听的
// 端口 + /healthz 契约把它当子进程拉起——应用源码全程不知道 niceeval 的存在。
//
// agent.py 里的 build_agent()(含 ChatOpenAI 客户端、AGENT_MODEL)和 LangSmith 的四个
// OTel 环境变量都只在进程启动时读一次,所以模型对比不能共用一个 server:按 model 分桶,
// 每个 model 各自的实例各拉各的进程、各挑各的空闲端口。
//
// 唯一和其它四个示例不同的地方:被测应用是 Python,子进程命令是 `.venv/bin/python`
// 不是 `node --import tsx/esm`。venv 需要提前手工建好(README 里的 `pnpm install` 等价物),
// 这里只检测、不自动建——自动建 venv 涉及网络装包,放进"第一次 send 就默默跑几分钟"不是
// 好体验,缺失时直接报错让人自己按 README 建。
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { existsSync } from "node:fs";

const APP_DIR = new URL("..", import.meta.url).pathname;
const PYTHON_BIN = `${APP_DIR}.venv/bin/python`;

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
  /** ctx.telemetry?.env——只在(按 model 分桶)首次 spawn 时生效,LangSmith 的四个
   *  OTel 变量都是启动时读一次的标准 OTel SDK 限制。 */
  readonly telemetryEnv?: Readonly<Record<string, string>>;
}

export async function ensureServer(options: EnsureServerOptions = {}): Promise<ServerHandle> {
  const key = options.model ?? "default";
  const existing = instances.get(key);
  if (existing) return existing.ready;

  if (!existsSync(PYTHON_BIN)) {
    throw new Error(
      `找不到 ${PYTHON_BIN}——先建 venv 再跑 eval:\n` +
        `  cd examples/zh/tier1/langgraph\n` +
        `  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`,
    );
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), ...options.telemetryEnv };
  if (options.model) env.AGENT_MODEL = options.model;

  const child = spawn(PYTHON_BIN, ["src/backend/server.py"], {
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
      `langgraph server(model=${key})在 30s 内未就绪:${baseUrl}/healthz。子进程 stderr:\n${stderr}`,
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
