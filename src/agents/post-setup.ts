// factory 的 postSetup / preTeardown 钩子执行器 —— Claude Code / Codex / Bub 共用。
// 契约见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」:
// postSetup 在 adapter 全部安装步骤(含 manifest)之后按数组顺序执行;preTeardown 与它成对,
// 按逆序、先于 agent 自己的 teardown 步骤执行(LIFO 镜像 —— postSetup 跑在 agent 安装之后,
// preTeardown 跑在 agent 收尾之前)。两者复用 SandboxHook 的窄上下文,不消费钩子返回值。
// 钩子抛错直接传播:postSetup 处于 setup 阶段(attempt errored);preTeardown 处于 teardown
// 阶段,由 runner 的 teardown 段按 teardown-failed 诊断收束。

import type { Sandbox, SandboxHook, SandboxHookContext } from "../sandbox/types.ts";
import type { AgentContext } from "./types.ts";

/** 窄上下文与沙箱钩子同款:不把 session / model / telemetry 借给过程钩子。 */
function narrowHookContext(ctx: AgentContext): SandboxHookContext {
  return {
    experimentId: ctx.experimentId,
    signal: ctx.signal,
    progress: (update) => ctx.progress(update),
    diagnostic: (input) => ctx.diagnostic(input),
  };
}

/**
 * postSetup 时点已走到的沙箱集合——preTeardown 的触发条件(成对触发规则:当且仅当同层 setup
 * 时点走到过)。按 sandbox 实例作键:并发 attempt 共享同一 factory 配置,沙箱是天然的
 * per-attempt 键;WeakSet 随沙箱对象回收,不泄漏。
 */
const postSetupPointReached = new WeakSet<Sandbox>();

/** 按数组顺序执行 postSetup 钩子。调用方在 adapter 全部安装步骤(含 manifest)之后调用一次;
 *  即使数组为空也要调——它同时标记「postSetup 时点走到过」(preTeardown 的触发条件)。 */
export async function runPostSetupHooks(
  sb: Sandbox,
  ctx: AgentContext,
  hooks: readonly SandboxHook[] | undefined,
): Promise<void> {
  postSetupPointReached.add(sb);
  if (!hooks?.length) return;
  const hookCtx = narrowHookContext(ctx);
  for (const hook of hooks) await hook(sb, hookCtx);
}

/**
 * 按逆序执行 preTeardown 钩子(LIFO 镜像 postSetup)。调用方在各自 `teardown` 方法的最前面
 * 调用一次,先于 agent 自己的收尾步骤。当且仅当本沙箱的 postSetup 时点走到过才执行——
 * adapter setup 在安装步骤中途抛错时,preTeardown 的成对前提不存在,静默跳过。
 */
export async function runPreTeardownHooks(
  sb: Sandbox,
  ctx: AgentContext,
  hooks: readonly SandboxHook[] | undefined,
): Promise<void> {
  if (!postSetupPointReached.has(sb)) return;
  if (!hooks?.length) return;
  const hookCtx = narrowHookContext(ctx);
  for (const hook of [...hooks].reverse()) await hook(sb, hookCtx);
}
