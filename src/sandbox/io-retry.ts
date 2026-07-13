// 已创建 Sandbox 的幂等文件 IO 重试。命令执行、appendLog、stop 不经过这里：
// 它们可能有不可重复的副作用，框架不能在调用者不知情时重跑。

import {
  classifySandboxIoError,
  isRetryableSandboxIoError,
  type SandboxIoErrorKind,
} from "./errors.ts";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;

export interface SandboxIoRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  classify?: (error: unknown) => SandboxIoErrorKind;
  /** 内部可观察挂点；runner feedback 接入后由统一包装层注入。 */
  onRetry?: (event: { attempt: number; delayMs: number; kind: SandboxIoErrorKind; error: unknown }) => void;
  /** 仅供确定性单测注入。 */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function withSandboxIoRetry<T>(
  operation: () => Promise<T>,
  options: SandboxIoRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const classify = options.classify ?? classifySandboxIoError;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const kind = classify(error);
      if (!isRetryableSandboxIoError(kind) || attempt >= maxAttempts) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1) * (0.5 + random());
      options.onRetry?.({ attempt, delayMs, kind, error });
      await sleep(delayMs);
    }
  }
}
