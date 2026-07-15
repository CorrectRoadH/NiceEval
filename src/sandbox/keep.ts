// 留存生命周期的 sandbox/ 域内路由:in-run 的 suspend(留存提交后转休眠)与事后命令
// (`niceeval sandbox list/enter/stop`)用的 detached 能力(不需要原来的 run 进程或 Sandbox
// 实例还活着)。provider 名的行为分支只允许出现在 sandbox/ 内(见 docs/architecture.md);
// 运行器与评分路径不感知 provider 名。

import type { Sandbox } from "../types.ts";

/** 有留存能力的 provider 实例都带一个非公开接口成员 suspend()(Sandbox 接口不因留存扩大)。 */
interface Suspendable {
  suspend(): Promise<void>;
}

/** provider 是否参与留存(defineSandbox 自定义 provider 不参与,创建前报错)。 */
export const KEEPABLE_PROVIDERS = new Set(["docker", "e2b", "vercel"]);

/** in-run 的休眠:留存提交成功后由 Scope release 调用(sandbox.suspend 阶段,有界计时)。 */
export async function suspendSandbox(sandbox: Sandbox): Promise<void> {
  const suspend = (sandbox as unknown as Partial<Suspendable>).suspend;
  if (typeof suspend !== "function") {
    throw new Error(`sandbox provider has no suspend capability (sandboxId=${sandbox.sandboxId})`);
  }
  await suspend.call(sandbox);
}

/** provider 原生的进入命令(记进注册表供直连与审计;日常入口是 `niceeval sandbox enter`)。 */
export function nativeEnterCommand(provider: string, sandboxId: string): string | undefined {
  switch (provider) {
    case "docker":
      return `docker start ${sandboxId} && docker exec -it ${sandboxId} bash`;
    case "e2b":
      return `e2b sandbox connect ${sandboxId}`;
    default:
      return undefined;
  }
}

export type DetachedState = "alive" | "dormant" | "expired";

/** 事后核对现场状态(docker 问本地 daemon;云 provider 按实例状态核对,查不到 = expired)。 */
export async function inspectDetached(provider: string, sandboxId: string): Promise<DetachedState> {
  switch (provider) {
    case "docker": {
      try {
        const { default: Docker } = await import("dockerode");
        const info = await new Docker().getContainer(sandboxId).inspect();
        return info.State?.Running ? "alive" : "dormant";
      } catch {
        return "expired";
      }
    }
    case "e2b": {
      try {
        const { Sandbox: E2BSdkSandbox } = await import("e2b");
        const list = (E2BSdkSandbox as unknown as {
          list?: (opts?: Record<string, unknown>) => Promise<Array<{ sandboxId: string; state?: string }>>;
        }).list;
        if (typeof list !== "function") return "dormant";
        const sandboxes = await list({ apiKey: process.env.E2B_API_KEY });
        const hit = sandboxes.find((s) => s.sandboxId === sandboxId || s.sandboxId.startsWith(sandboxId));
        if (!hit) return "expired";
        return hit.state === "running" ? "alive" : "dormant";
      } catch {
        return "expired";
      }
    }
    case "vercel": {
      try {
        const { Sandbox: VSandbox } = await import("@vercel/sandbox");
        const get = (VSandbox as unknown as { get?: (opts: Record<string, unknown>) => Promise<unknown> }).get;
        if (typeof get !== "function") return "dormant";
        const found = await get({ sandboxId });
        return found ? "dormant" : "expired";
      } catch {
        return "expired";
      }
    }
    default:
      return "expired";
  }
}

/**
 * detached 销毁:按注册表条目的 provider 名路由,不需要 Sandbox 实例。
 * 返回 "stopped"(成功销毁)或 "already-gone"(实例已不存在,幂等);
 * 其它错误上抛——调用方保留登记项并退出 1,不能把仍活着的资源从管理面隐藏掉。
 */
export async function destroyDetached(provider: string, sandboxId: string): Promise<"stopped" | "already-gone"> {
  switch (provider) {
    case "docker": {
      const { default: Docker } = await import("dockerode");
      const container = new Docker().getContainer(sandboxId);
      try {
        await container.remove({ force: true });
        return "stopped";
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode === 404) return "already-gone";
        throw e;
      }
    }
    case "e2b": {
      const { Sandbox: E2BSdkSandbox } = await import("e2b");
      const kill = (E2BSdkSandbox as unknown as {
        kill?: (id: string, opts?: Record<string, unknown>) => Promise<boolean>;
      }).kill;
      if (typeof kill !== "function") throw new Error("this e2b SDK version has no detached kill capability");
      const killed = await kill(sandboxId, { apiKey: process.env.E2B_API_KEY });
      return killed ? "stopped" : "already-gone";
    }
    case "vercel": {
      const { Sandbox: VSandbox } = await import("@vercel/sandbox");
      const get = (VSandbox as unknown as {
        get?: (opts: Record<string, unknown>) => Promise<{ stop(): Promise<void> } | null>;
      }).get;
      if (typeof get !== "function") throw new Error("this vercel SDK version has no detached get capability");
      const found = await get({ sandboxId }).catch(() => null);
      if (!found) return "already-gone";
      await found.stop();
      return "stopped";
    }
    default:
      throw new Error(`provider "${provider}" has no detached stop channel`);
  }
}

/** 唤醒休眠现场(enter / history / diff 前);docker start,云 provider 按 SDK 恢复。 */
export async function wakeDetached(provider: string, sandboxId: string): Promise<void> {
  switch (provider) {
    case "docker": {
      const { default: Docker } = await import("dockerode");
      const container = new Docker().getContainer(sandboxId);
      const info = await container.inspect();
      if (!info.State?.Running) await container.start();
      return;
    }
    case "e2b": {
      const { Sandbox: E2BSdkSandbox } = await import("e2b");
      const resume = (E2BSdkSandbox as unknown as {
        resume?: (id: string, opts?: Record<string, unknown>) => Promise<unknown>;
        connect?: (id: string, opts?: Record<string, unknown>) => Promise<unknown>;
      });
      if (typeof resume.resume === "function") {
        await resume.resume(sandboxId, { apiKey: process.env.E2B_API_KEY });
        return;
      }
      if (typeof resume.connect === "function") {
        await resume.connect(sandboxId, { apiKey: process.env.E2B_API_KEY });
        return;
      }
      throw new Error("this e2b SDK version has no resume capability");
    }
    default:
      throw new Error(`provider "${provider}" has no wake channel`);
  }
}

/** 送回休眠(enter 退出后 / history、diff 读完后)。 */
export async function suspendDetached(provider: string, sandboxId: string): Promise<void> {
  switch (provider) {
    case "docker": {
      const { default: Docker } = await import("dockerode");
      await new Docker().getContainer(sandboxId).stop({ t: 5 });
      return;
    }
    case "e2b": {
      const { Sandbox: E2BSdkSandbox } = await import("e2b");
      const pause = (E2BSdkSandbox as unknown as {
        pause?: (id: string, opts?: Record<string, unknown>) => Promise<unknown>;
      }).pause;
      if (typeof pause === "function") {
        await pause(sandboxId, { apiKey: process.env.E2B_API_KEY });
        return;
      }
      throw new Error("this e2b SDK version has no detached pause capability");
    }
    default:
      throw new Error(`provider "${provider}" has no suspend channel`);
  }
}
