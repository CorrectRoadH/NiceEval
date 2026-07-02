// 在沙箱内部起一个轻量 OTLP/HTTP 接收器,供 e2b / vercel 等远程沙箱使用。
// 流程:
//   1. writeFiles 把 collector 脚本上传到沙箱
//   2. runShell 在后台启动它(node ... & echo $!),拿 PID;collector 用内核分配端口
//      (listen 0)并把实际端口写回端口文件,host 轮询读回 —— 不写死 4318,沙箱里已有
//      服务占用端口时不会冲突
//   3. agent 往 http://127.0.0.1:<port>/v1/traces 发 span(sandbox 内 localhost)
//   4. settle() 轮询 spans 文件大小直到静默(而不是固定 sleep:等太久拖慢每个 eval,
//      等不够漏掉在途 batch),再下载解析,缓存到内存
//   5. collect() 返回缓存(同步,与本地 receiver 接口一致)
//   6. close() 尝试 kill PID(沙箱本身也会停,所以 best-effort)
//
// 文件路径带随机后缀:同一沙箱跨 eval 复用时,每个 receiver 实例的脚本 / spans /
// 端口文件互不串扰,collector 也不会读到上一个 eval 的 span。

import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { TraceSpan } from "../../types.ts";
import type { Sandbox } from "../../types.ts";
import type { TraceReceiver } from "./receiver.ts";
import { parseOtlpTraces } from "./parse.ts";

// collector 脚本:纯 Node.js CJS,无外部依赖。
// 每收一个 OTLP/HTTP 请求就把 { ct, body(base64) } 追加写一行到 spans 文件,
// 同时处理 gzip 解压——这样 host 侧直接复用 parseOtlpTraces 解析。
function collectorScript(spansPath: string, portPath: string): string {
  return /* js */ `
'use strict';
const http = require('http');
const fs   = require('fs');
const zlib = require('zlib');
const OUT  = ${JSON.stringify(spansPath)};
const server = http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let body = Buffer.concat(chunks);
    const ct = req.headers['content-type'] || '';
    const ce = req.headers['content-encoding'] || '';
    if (ce.includes('gzip') || (body[0] === 0x1f && body[1] === 0x8b)) {
      try { body = zlib.gunzipSync(body); } catch {}
    }
    try { fs.appendFileSync(OUT, JSON.stringify({ ct, b: body.toString('base64') }) + '\\n'); } catch {}
    if (ct.includes('json')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    } else {
      res.writeHead(200, { 'content-type': 'application/x-protobuf' }).end(Buffer.alloc(0));
    }
  });
  req.on('error', () => res.writeHead(400).end());
});
server.listen(0, '127.0.0.1', () => {
  try { fs.writeFileSync(${JSON.stringify(portPath)}, String(server.address().port)); } catch {}
});
`;
}

export function createInSandboxTraceReceiver(sandbox: Sandbox) {
  return Effect.acquireRelease(
    Effect.promise(() => makeInSandboxReceiver(sandbox)),
    (r) => Effect.promise(() => r.close().catch(() => {})),
  );
}

async function makeInSandboxReceiver(sandbox: Sandbox): Promise<TraceReceiver> {
  let cached: TraceSpan[] = [];

  const tag = randomUUID().slice(0, 8);
  const collectorPath = `/tmp/.niceeval-otlp-collector-${tag}.cjs`;
  const spansPath = `/tmp/.niceeval-otlp-spans-${tag}.jsonl`;
  const portPath = `/tmp/.niceeval-otlp-port-${tag}`;
  const logPath = `/tmp/.niceeval-otlp-collector-${tag}.log`;

  // 上传 collector 脚本
  await sandbox.writeFiles({ [collectorPath]: collectorScript(spansPath, portPath) });

  // 后台启动,拿 PID(shell 的 & 返回后台 PID;echo $! 给我们)
  const startResult = await sandbox.runShell(`node ${collectorPath} >${logPath} 2>&1 & echo $!`);
  const pid = parseInt(startResult.stdout.trim(), 10);

  // 轮询读回内核分配的端口(collector listen 回调里写端口文件)。
  let port = 0;
  for (let i = 0; i < 20 && !port; i++) {
    const read = await sandbox.runShell(`cat ${portPath} 2>/dev/null || true`);
    port = parseInt(read.stdout.trim(), 10) || 0;
    if (!port) await new Promise((r) => setTimeout(r, 150));
  }
  if (!port) {
    const log = await sandbox.runShell(`cat ${logPath} 2>/dev/null || true`).catch(() => undefined);
    throw new Error(
      `in-sandbox OTLP collector failed to report its port within 3s. Collector log:\n${log?.stdout.trim() || "(empty)"}`,
    );
  }

  return {
    endpoint: (_host) => `http://127.0.0.1:${port}/v1/traces`,

    collect: () => cached.slice(),

    // agent 结束后调:轮询 spans 文件大小,连续 quietMs 无增长(exporter flush 完)即收口。
    async settle(quietMs, maxMs) {
      const t0 = Date.now();
      let lastSize = -1;
      let stableSince = Date.now();
      while (Date.now() - t0 < maxMs) {
        const res = await sandbox
          .runShell(`wc -c < ${spansPath} 2>/dev/null || echo 0`)
          .catch(() => ({ stdout: "0" }));
        const size = parseInt(res.stdout.trim(), 10) || 0;
        if (size !== lastSize) {
          lastSize = size;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= quietMs) {
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      try {
        const raw = await sandbox.downloadFile(spansPath);
        cached = parseSpansFile(raw);
      } catch {
        // 没有 spans 文件(agent 没发任何 trace)→ 保留空数组
      }
    },

    async close() {
      if (Number.isFinite(pid) && pid > 0) {
        // best-effort:沙箱停止时进程也会消失,这里只是提前清理
        await sandbox.runShell(`kill ${pid} 2>/dev/null || true`).catch(() => {});
      }
    },
  };
}

// spans 文件每行一个 { ct: string; b: string(base64) }
function parseSpansFile(raw: Buffer): TraceSpan[] {
  const spans: TraceSpan[] = [];
  const text = raw.toString("utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const { ct, b } = JSON.parse(trimmed) as { ct: string; b: string };
      const body = Buffer.from(b, "base64");
      spans.push(...parseOtlpTraces(body, ct));
    } catch {
      // 跳过损坏行
    }
  }
  return spans;
}
