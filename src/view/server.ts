// HTTP server:把站点管线(site.ts 的 planSite)产出的同一份产物挂在 127.0.0.1 上按路径服务。
// 这里不携带任何取数或布局知识——查不到清单条目就是 404,与 `--out` 写盘的文件逐字节一致
// (docs/feature/reports/view.md 开篇;奇偶由 site-parity 测试守护)。宿主语义只有三条,全部
// 作用在管线输入端:打开首页整份重建(数据永远是盘上最新)、单页渲染失败折成页内错误块
// (pageFailure: "embed")、报告槽可被位置参数 / --experiment 收窄。

import { createServer, type Server } from "node:http";
import { type ViewScanOptions } from "./data.ts";
import { planSite, readSiteFile, type SitePlan } from "./site.ts";
import { formatThrown } from "../util.ts";

export interface ViewOptions {
  input?: string;
  out?: string;
  port?: number;
  /** `--out` 对非发布根(无 publish:applied 标记)导出时的显式确认;静态站原样携带证据文件。 */
  allowSensitiveArtifacts?: boolean;
  /** 报告槽的组合语义(位置前缀 / --experiment / --report),透传给站点管线。 */
  scan?: ViewScanOptions;
}

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

export async function startViewServer(opts: ViewOptions = {}): Promise<ViewServer> {
  const input = opts.input;
  // 本地 server 的单页失败折成该页的错误块,其它页照常可读(静态导出仍整体失败)。
  const scanOptions = { ...opts.scan, pageFailure: "embed" as const };

  // 产物重建的单飞通道:首页请求整份重建;并发请求共享同一次构建,不重复扫描。
  let current: Promise<SitePlan>;
  const rebuild = (): Promise<SitePlan> => {
    current = planSite(input, scanOptions);
    return current;
  };

  // 启动前先构建一遍:--snapshot 指向读不了的快照、--report 装载失败、前缀匹配不到,
  // 都要在起 server 前就失败并给出提示。
  await rebuild();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
        return;
      }

      // 站点相对路径:`/` 即 index.html;兼容旧的 /artifact?p= query 形式
      // (0.2.x 前端烘焙的 HTML 可能还开着)。
      let sitePath: string;
      if (url.pathname === "/") {
        // 每次打开首页整份重建,永远是盘上最新数据;--report 的报告文件变更同样在
        // 下次请求整页重算(装载走 mtime cache-busting,见 report/load.ts)。
        await rebuild();
        sitePath = "index.html";
      } else if (url.pathname === "/artifact") {
        sitePath = `artifact/${url.searchParams.get("p") ?? ""}`;
      } else {
        sitePath = decodeURIComponent(url.pathname.slice(1));
      }

      let plan = await current;
      let file = plan.files.get(sitePath);
      if (!file && sitePath.startsWith("artifact/")) {
        // 未命中最近一次构建的产物清单:管线重建一次再查——server 运行期间
        // 新落盘的证据(新快照、补跑)不需要重启。
        plan = await rebuild();
        file = plan.files.get(sitePath);
      }
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      const body = await readSiteFile(file);
      if (body === undefined) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": file.contentType, "cache-control": "no-store" });
      res.end(body);
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
