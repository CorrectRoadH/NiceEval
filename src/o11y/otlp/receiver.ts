// 本机 OTLP/HTTP traces 接收器:每个沙箱起一个,容器里的 agent 把 OTLP 导出到它。
// 监听 0.0.0.0 的临时端口(容器经 host.docker.internal 回连宿主),收到的 span 攒着,
// 跑完由运行器一次性 collect 挂到 EvalResult.trace。只认 POST .../v1/traces。

import { createServer } from "node:http";
import type { TraceSpan } from "../../types.ts";
import { parseOtlpTraces } from "./parse.ts";

export interface TraceReceiver {
  /** agent 应导出到的完整端点(host 由后端定:docker → host.docker.internal)。 */
  endpoint(host: string): string;
  /** 目前为止收到并解析出的全部 span(副本)。 */
  collect(): TraceSpan[];
  /** 给在途的最后一批导出留点落地时间(无新 span 持续 quietMs 即返回,至多 maxMs)。 */
  settle(quietMs: number, maxMs: number): Promise<void>;
  close(): Promise<void>;
}

export async function createTraceReceiver(): Promise<TraceReceiver> {
  const spans: TraceSpan[] = [];
  let lastAt = 0;

  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const ct = req.headers["content-type"] ?? "";
      try {
        const parsed = parseOtlpTraces(Buffer.concat(chunks), ct);
        if (parsed.length) {
          spans.push(...parsed);
          lastAt = Date.now();
        }
      } catch {
        // 解析失败不回 5xx,免得导出端重试刷屏。
      }
      // OTLP 成功响应:空 ExportTraceServiceResponse(JSON {} / protobuf 空 body)。
      if (ct.includes("json")) {
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } else {
        res.writeHead(200, { "content-type": "application/x-protobuf" }).end(Buffer.alloc(0));
      }
    });
    req.on("error", () => res.writeHead(400).end());
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    // 0.0.0.0:容器经 host-gateway / host.docker.internal 回连宿主,不能只听 127.0.0.1。
    server.listen(0, "0.0.0.0", () => {
      const a = server.address();
      resolve(typeof a === "object" && a ? a.port : 0);
    });
  });

  return {
    endpoint: (host) => `http://${host}:${port}/v1/traces`,
    collect: () => spans.slice(),
    async settle(quietMs, maxMs) {
      // 等到「收到过 span 且静默 quietMs」或「整体超 maxMs」。还没收到任何 span 时
      // 也一直等到 maxMs —— 最后一批导出可能正在途中(进程刚退、POST 还没到)。
      const deadline = Date.now() + maxMs;
      for (;;) {
        if (Date.now() >= deadline) return;
        if (lastAt !== 0 && Date.now() - lastAt >= quietMs) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
