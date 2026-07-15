// provider 无关的 provisioning 退避重试:createProvider()(resolve.ts)对每个内置
// provider 的 create() 套这一层。只有各 provider 自己的 classifyProvisionError 判为
// 可重试(目前仅 rate_limit)的错误才会退避重试;其它错误第一次就抛出。

import { isRetryableProvisionError, type SandboxProvisionErrorKind } from "./errors.ts";
import { t } from "../i18n/index.ts";
import { reportActivity } from "../runner/feedback/sink.ts";
import type { ScopedFeedback } from "../types.ts";

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;

/** 指数退避 + 全抖动(0.5x~1.5x),避免同一批被限流的 create() 同时醒来再次撞限流。 */
function delayFor(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt * (0.5 + Math.random());
}

/**
 * 调用方(resolve.ts)持有的并发槽位的临时归还/收回。不认调用方用的是不是 Effect —— 只要求
 * 两个 async 方法,保持这层 provider 无关。
 */
export interface ProvisionSlot {
  release(): Promise<void>;
  reacquire(): Promise<void>;
}

export async function withProvisionRetry<T>(
  create: () => Promise<T>,
  classify: (e: unknown) => SandboxProvisionErrorKind,
  slot?: ProvisionSlot,
  feedback?: ScopedFeedback,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await create();
    } catch (e) {
      if (!isRetryableProvisionError(classify(e)) || attempt >= MAX_ATTEMPTS - 1) throw e;
      // 退避期间只是在睡觉,不是在真的创建沙箱:攥着并发槽位陪跑 setTimeout 会让被限流的
      // provider 把整批并发名额拖垮成"看起来卡在个位数并发"——先还名额,睡醒了再排队要回来。
      if (slot) await slot.release();
      // 「activity」而非「diagnostic」—— 这是正常的退避进度,不是需要去重/永久留痕的
      // warning(与 docker.ts 的镜像拉取进度、vercel.ts 的 session rotate 通知同一个理由,
      // 见 sink.ts 的 reportActivity 说明)。让 human dashboard 的 active slot 在整个退避
      // 窗口里有可见更新,而不是冻结到重试成功或耗尽为止。
      const delayMs = delayFor(attempt);
      const message = t("sandbox.provisionRetry", { delayMs: Math.round(delayMs), attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS }).trimEnd();
      if (feedback) feedback.progress({ message });
      else reportActivity(message);
      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } finally {
        if (slot) await slot.reacquire();
      }
    }
  }
}
