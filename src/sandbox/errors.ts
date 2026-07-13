// 沙箱 provisioning 错误的中性分类:各 provider SDK 的限流错误形状互不相同(e2b 抛
// RateLimitError,vercel 抛 APIError{ response.status: 429 },docker 是 dockerode 的
// 普通 Error,message 里带 "toomanyrequests")。resolve.ts 的 createProvider() 据此统一
// 做退避重试,不需要认识任何 provider 专属的错误类型——分类逻辑留在各 provider 自己的
// 文件里(见 e2b.ts / vercel.ts / docker.ts 的 classifyProvisionError)。

/** 目前只区分"限流,值得退避重试"和"其它,原样抛出"。 */
export type SandboxProvisionErrorKind = "rate_limit" | "unknown";

/** 按 kind 判断是否该重试;模板不存在、凭据缺失等归入 unknown,第一次就抛,重试没有意义。 */
export function isRetryableProvisionError(kind: SandboxProvisionErrorKind): boolean {
  return kind === "rate_limit";
}

/**
 * 已创建 Sandbox 上单次文件 IO 的中性错误分类。这里描述的是传输层瞬时故障，
 * 不是文件不存在、权限不足、路径错误等确定性结果。
 */
export type SandboxIoErrorKind = "rate_limit" | "network" | "service_unavailable" | "unknown";

export function isRetryableSandboxIoError(kind: SandboxIoErrorKind): boolean {
  return kind !== "unknown";
}

/**
 * 内置 provider 与自定义 provider 共用的保守分类器。SDK 常把底层网络错误包在
 * `cause` 中，因此最多沿 cause 链向下检查几层；Abort/沙箱终止明确不重试。
 */
export function classifySandboxIoError(error: unknown): SandboxIoErrorKind {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const record = typeof current === "object" ? current as Record<string, unknown> : undefined;
    const name = record && typeof record.name === "string" ? record.name : "";
    const message = current instanceof Error ? current.message : String(current);

    if (/abort|cancel|terminated|killed|sandbox.*(closed|stopped)/i.test(`${name} ${message}`)) return "unknown";

    const status = numericStatus(record);
    if (status === 429) return "rate_limit";
    if (status !== undefined && status >= 500 && status <= 599) return "service_unavailable";

    const code = record && typeof record.code === "string" ? record.code : "";
    if (/^(ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT)$/i.test(code)) {
      return "network";
    }
    if (/fetch failed|socket hang up|network error|connection (?:reset|closed)|temporary failure|timed out while (?:fetching|uploading|downloading)/i.test(message)) {
      return "network";
    }
    if (/too many requests|rate.?limit|\b429\b/i.test(message)) return "rate_limit";
    if (/service unavailable|bad gateway|gateway timeout|\b50[0234]\b/i.test(message)) return "service_unavailable";

    current = record?.cause;
  }
  return "unknown";
}

function numericStatus(record: Record<string, unknown> | undefined): number | undefined {
  if (!record) return undefined;
  if (typeof record.status === "number") return record.status;
  if (typeof record.statusCode === "number") return record.statusCode;
  const response = record.response;
  if (response && typeof response === "object") {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}
