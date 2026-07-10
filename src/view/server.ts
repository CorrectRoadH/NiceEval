// HTTP server 与静态资源:起本地 web、按需吐工件、把 viewData 烘焙进单个 HTML。
// 数据读取与统计在 data.ts(openResults + 官方计算函数);这里只管「怎么送到浏览器」。

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadViewScan, viewRoot, type ViewScan } from "./data.ts";
import { formatThrown } from "../util.ts";

export interface ViewOptions {
  input?: string;
  out?: string;
  port?: number;
}

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

const TEMPLATE_PLACEHOLDERS = {
  styles: "<!-- __NICEEVAL_STYLES__ -->",
  appCode: "__NICEEVAL_APP_CODE__",
  viewData: "__NICEEVAL_VIEW_DATA_JSON__",
} as const;

export async function startViewServer(opts: ViewOptions = {}): Promise<ViewServer> {
  const input = opts.input;
  const root = viewRoot(input);
  // 数据装载先跑一遍:单文件模式指向读不了的报告时,要在起 server 前就失败并给出提示。
  await loadViewScan(input);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
        return;
      }
      // 按需提供拆分工件(trace.json / events.json / …),前端展开时 fetch。
      // 路径式 /artifact/<rel> 与目录式静态导出的文件布局一致(见 view/index.ts 的 buildView),
      // 同一份前端产物在本地 server 和静态托管上用同一个相对 URL。
      if (url.pathname.startsWith("/artifact/")) {
        await serveArtifact(root, decodeURIComponent(url.pathname.slice("/artifact/".length)), res);
        return;
      }
      // 兼容旧的 query 形式(0.2.x 前端烘焙的 HTML 可能还开着)。
      if (url.pathname === "/artifact") {
        await serveArtifact(root, url.searchParams.get("p") ?? "", res);
        return;
      }
      if (url.pathname !== "/") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      // 每次请求现读现算,永远是盘上最新数据。
      res.end(await renderHtml(await loadViewScan(input)));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(formatThrown(e));
    }
  });

  const port = await listen(server, opts.port ?? 0);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      }),
  };
}

/** 把 viewData(只含原始值与相对路径,不含宿主机绝对路径)和前端产物烘焙进单个 HTML。 */
export async function renderHtml(scan: ViewScan): Promise<string> {
  const template = await readViewAsset("template.html");
  const styles = await readViewAsset("client-dist/app.css");
  const app = await readViewAsset("client-dist/app.js");

  return template
    .replace(TEMPLATE_PLACEHOLDERS.styles, () => `<style>\n${styles}\n</style>`)
    .replace(TEMPLATE_PLACEHOLDERS.viewData, () => JSON.stringify(scan.viewData).replace(/</g, "\\u003c"))
    .replace(TEMPLATE_PLACEHOLDERS.appCode, () => JSON.stringify(app).replace(/</g, "\\u003c"));
}

/** 安全地把 root 下的工件文件吐回去(限定 .json,且解析后必须仍在 root 内)。 */
async function serveArtifact(
  root: string,
  rel: string,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const abs = resolve(root, rel);
  const within = abs === root || abs.startsWith(root + "/");
  if (!within || !rel.endsWith(".json")) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("bad artifact path");
    return;
  }
  try {
    const body = await readFile(abs, "utf-8");
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("artifact not found");
  }
}

async function readViewAsset(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf-8");
}

async function listen(server: Server, preferredPort: number): Promise<number> {
  const tryListen = (port: number): Promise<number> =>
    new Promise((resolveListen, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolveListen(typeof address === "object" && address ? address.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });

  if (preferredPort === 0) return tryListen(0);
  for (let port = preferredPort; port < preferredPort + 20; port++) {
    try {
      return await tryListen(port);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    }
  }
  throw new Error(`No available port near ${preferredPort}`);
}
