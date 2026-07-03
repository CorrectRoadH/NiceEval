// 把 ../src/backend/server.ts 当成一个外部黑盒服务来跑:eval 侧不 import 应用代码,只按它
// 监听的端口 + /healthz 契约把它当子进程管起来。应用源码(src/backend/server.ts /
// src/backend/agent.ts / src/backend/tools.ts)全程不知道 niceeval 的存在 —— 这是本示例
// "non-invasive"的关键。

import { spawn, type ChildProcess } from "node:child_process";

const PORT = 5189;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

// eval/claude-sdk/ 目录(.env、package.json 所在处),不是本文件所在的 agents/。
const APP_DIR = new URL("..", import.meta.url).pathname;

let child: ChildProcess | undefined;
let readyPromise: Promise<void> | undefined;

async function isUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE_URL}/healthz`);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 首次调用时拉起 `node --env-file .env --import tsx/esm src/backend/server.ts` 子进程,轮询
 * /healthz 直到就绪。后续调用:如果服务已经在跑(比如上一次 niceeval 运行遗留、或本进程
 * 内已经起过),直接复用,不重复 spawn —— 用同一个 readyPromise 单例挡住并发 send 的重复启动。
 */
export async function ensureServer(): Promise<void> {
  if (await isUp()) return;

  readyPromise ??= (async () => {
    child = spawn("node", ["--env-file", ".env", "--import", "tsx/esm", "src/backend/server.ts"], {
      cwd: APP_DIR,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      // 子进程意外退出:清掉引用和就绪 promise,让下一次 send 有机会重新拉起。
      child = undefined;
      readyPromise = undefined;
      if (code !== 0 && code !== null) {
        process.stderr.write(`[claude-sdk] server exited early: code=${code} signal=${signal}\n`);
      }
    });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await isUp()) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`claude-sdk server did not become healthy within 15s at ${BASE_URL}/healthz`);
  })();

  return readyPromise;
}

function shutdown(): void {
  child?.kill();
  child = undefined;
}

process.on("exit", shutdown);
