// 沙箱后端解析:把 --sandbox / env 折叠成一个具体后端,并按需创建实例。
// 后端名的行为分支只允许出现在 sandbox/ 内(见 docs/architecture.md)。

import { Effect } from "effect";
import type { Sandbox, SandboxBackend } from "../types.ts";
import { DockerSandbox } from "./docker.ts";

/**
 * 决定用哪个后端:
 * - 显式指定且非 "auto" → 直接用。
 * - 否则:env 里有 VERCEL_TOKEN / VERCEL_OIDC_TOKEN → "vercel"。
 * - 再否则 → "docker"。
 */
export function resolveBackend(opts: { backend?: SandboxBackend }): SandboxBackend {
  const { backend } = opts;
  if (backend && backend !== "auto") {
    return backend;
  }
  if (process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN) {
    return "vercel";
  }
  return "docker";
}

/**
 * 按解析出的后端创建沙箱,并把 stop() 注册为 Scope 回收动作。
 * 在 Effect.scoped / Effect.gen 里 yield* 即可;成功/失败/中断都保证 stop。
 */
export function createSandbox(opts: {
  backend?: SandboxBackend;
  timeout?: number;
  runtime?: "node20" | "node24";
}) {
  const backend = resolveBackend(opts);
  return Effect.acquireRelease(
    Effect.promise(() => {
      switch (backend) {
        case "docker":
          return DockerSandbox.create({ timeout: opts.timeout, runtime: opts.runtime });
        default:
          throw new Error(`${backend} sandbox backend not implemented; use docker`);
      }
    }),
    (sb) => Effect.promise(() => sb.stop().catch(() => {})),
  );
}
