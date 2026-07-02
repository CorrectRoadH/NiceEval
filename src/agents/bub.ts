import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import { createCheckpoint, restoreCheckpoint } from "../sandbox/checkpoint.ts";
import { mapBubSpans } from "../o11y/otlp/mappers/bub.ts";
import type { Agent, Sandbox } from "../types.ts";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { t } from "../i18n/index.ts";

// ───────────────────────────────────────────────────────────────────────────
// bub 的 agent adapter(沙箱型)。
//
// ⚠️ 现实校正:bub 是 PyPI 上的 `bub`(alpha,Python 3.12),不是 npm 包。
//    · 安装:uv tool install bub(uv 自带 python 3.12,免 root)。
//    · 调用:bub run "<prompt>" --session-id <id> --workspace <path>
//    · 模型 + 代理:BUB_MODEL=openai:<model>、BUB_API_BASE、BUB_API_KEY。
//    · 记忆:tape(总是开),落盘在 ~/.bub/tapes/<md5(ws)[:16]>__<md5(sess)[:16]>.jsonl。
// ───────────────────────────────────────────────────────────────────────────

export interface BubConfig {
  /** OpenAI 兼容代理的 API key。省略时读 BUB_API_KEY env。 */
  apiKey?: string;
  /** OpenAI 兼容代理的 base URL。省略时读 BUB_API_BASE env。 */
  apiBase?: string;
  /**
   * 额外装进 bub tool 环境的 Python 包(pip 名或 git URL)。
   * 每个沙箱 setup 时作为 `uv tool install --with <pkg>` 追加到 bub 环境里。
   * 示例:["bub-plugin-memory", "git+https://github.com/..."]
   */
  pythonPlugins?: string[];
}

const UV = "$HOME/.local/bin/uv";
// bub 二进制:优先用镜像里(预制模板)烘焙在 PATH 上的 bub,否则用 uv 装到 $HOME/.local/bin 的那个。
// 预制模板把 bub 装到 /usr/local/bin(见 sandbox/docker/Dockerfile),command -v 命中即用 → 跳过安装。
const BUB = "$(command -v bub || echo $HOME/.local/bin/bub)";

// TODO(upstream): 这两个默认值钉在个人 fork 的修复分支上,等上游合并后改回发布版并删掉本注释。
// 可用 NICEEVAL_BUB_OVERRIDE / NICEEVAL_BUB_OTEL_PLUGIN 覆盖,不必改源码。
const BUB_OVERRIDE =
  getEnv("NICEEVAL_BUB_OVERRIDE") ??
  "bub @ git+https://github.com/CorrectRoadH/bub.git@fix/streaming-usage-include-usage";
const BUB_OVERRIDE_FILE = "/tmp/bub-override.txt";
const OTEL_PLUGIN =
  getEnv("NICEEVAL_BUB_OTEL_PLUGIN") ??
  "git+https://github.com/CorrectRoadH/bub-contrib.git@fix/tapestore-otel-tape-entry-validation" +
    "#subdirectory=packages/bub-tapestore-otel";

const INSTALL_SPEC = `bub --override(${BUB_OVERRIDE}) --with ${OTEL_PLUGIN}`;
const INSTALL_HASH = createHash("md5").update(INSTALL_SPEC).digest("hex").slice(0, 12);

function diskCachePath(home: string): string {
  const homeKey = createHash("md5").update(home).digest("hex").slice(0, 8);
  return join(homedir(), ".cache", "niceeval", `bub-checkpoint-${homeKey}-${INSTALL_HASH}.bin`);
}

// in-memory checkpoint + mutex keyed by sandbox $HOME,
// so Docker(/home/node)と Vercel(/home/vercel-sandbox)でキャッシュが混ざらない。
const memCheckpoints = new Map<string, Buffer>();
const installsInProgress = new Map<string, Promise<void>>();

async function ensureBub(sb: Sandbox, home: string): Promise<void> {
  // 预制模板已把 bub 烘焙进镜像(PATH 上)→ 直接用,跳过 uv 安装 + checkpoint 全套。
  if ((await sb.runShell("command -v bub >/dev/null 2>&1")).exitCode === 0) return;

  const checkpointPaths = [`${home}/.local`, `${home}/.cache/uv`];
  const cachePath = diskCachePath(home);

  const mem = memCheckpoints.get(home);
  if (mem) { await restoreCheckpoint(sb, mem); return; }

  const disk = await readFile(cachePath).catch(() => undefined);
  if (disk) {
    try { await restoreCheckpoint(sb, disk); memCheckpoints.set(home, disk); return; } catch { /* 损坏,回退 */ }
  }

  const inflight = installsInProgress.get(home);
  if (inflight) {
    await inflight;
    const after = memCheckpoints.get(home);
    if (after) { await restoreCheckpoint(sb, after); return; }
  }

  let resolveInstall!: () => void;
  let rejectInstall!: (e: unknown) => void;
  const installPromise = new Promise<void>((res, rej) => { resolveInstall = res; rejectInstall = rej; });
  installsInProgress.set(home, installPromise);

  try {
    await sb.runShell(`test -x ${UV} || (curl -LsSf https://astral.sh/uv/install.sh | sh)`);
    await sb.runShell(`printf '%s\\n' '${BUB_OVERRIDE}' > ${BUB_OVERRIDE_FILE}`);
    let last = { stdout: "", stderr: "" };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const install = await sb.runShell(
        `${UV} tool install --reinstall --python 3.12 --prerelease allow 'bub' --overrides ${BUB_OVERRIDE_FILE} --with '${OTEL_PLUGIN}'`,
      );
      if (install.exitCode === 0) break;
      last = install;
      if (attempt === 3) {
        throw new Error(t("bub.installFailed", {
          attempts: 3,
          tail: (last.stdout + last.stderr).split("\n").slice(-15).join("\n"),
        }));
      }
    }
    const cp = await createCheckpoint(sb, checkpointPaths);
    memCheckpoints.set(home, cp);
    await mkdir(dirname(cachePath), { recursive: true }).catch(() => {});
    await writeFile(cachePath, cp).catch(() => {});
    resolveInstall();
  } catch (e) {
    rejectInstall(e);
    throw e;
  } finally {
    // 成功/失败都清锁:锁只表达「正在装」,装完后 memCheckpoints 是唯一缓存事实源。
    installsInProgress.delete(home);
  }
}

function tapePath(workspace: string, sessionId: string, bubHome: string): string {
  const w = createHash("md5").update(workspace).digest("hex").slice(0, 16);
  const s = createHash("md5").update(sessionId).digest("hex").slice(0, 16);
  return `${bubHome}/tapes/${w}__${s}.jsonl`;
}

export function bubAgent(config?: BubConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("BUB_API_KEY");
  const getApiBase = () => config?.apiBase ?? requireEnv("BUB_API_BASE");
  // sandboxId → { home, workspace }; persists values detected in setup() so send() can use them.
  const sessionInfo = new Map<string, { home: string; workspace: string }>();

  return defineSandboxAgent({
    name: "bub",
    capabilities: { conversation: true, toolObservability: true, workspace: true, compactionObservability: true, tracing: true },
    spanMapper: mapBubSpans,

    tracing: {
      protocol: "http/protobuf",
      env: (endpoint) => ({
        BUB_TAPESTORE_OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
      }),
    },

    async setup(sb) {
      // home 必须来自运行时探测:各 sandbox 后端不同(/home/node、/home/vercel-sandbox…),
      // 兜一个后端专属常量会静默走错路径(tape 读不到 → 空事件流 → 负断言假通过)。
      const home = (await sb.runShell("printf '%s' $HOME")).stdout.trim();
      if (!home) throw new Error(t("bub.homeDetectFailed"));
      const workspace = sb.workdir;
      sessionInfo.set(sb.sandboxId, { home, workspace });
      await ensureBub(sb, home);

      if (config?.pythonPlugins?.length) {
        const extraWith = config.pythonPlugins.map((p) => `--with '${p}'`).join(" ");
        await sb.runShell(
          `${UV} tool install --reinstall --python 3.12 --prerelease allow 'bub' --overrides ${BUB_OVERRIDE_FILE} --with '${OTEL_PLUGIN}' ${extraWith}`,
        );
      }

      if (!(await sb.fileExists(`${workspace}/AGENTS.md`))) {
        await shared.writeFile(
          sb,
          `${workspace}/AGENTS.md`,
          [
            `You are a coding agent working in a Next.js project at ${workspace}.`,
            ``,
            `Implement the requested feature by writing files directly to disk with the available tools:`,
            `- fs_write(path, content): create or overwrite a file`,
            `- fs_edit(path, old, new): edit an existing file`,
            `- bash(cmd): run shell commands`,
            ``,
            `Do NOT respond with only a text explanation — write the actual code files.`,
            `After writing, verify with bash("cd ${workspace} && npm run build").`,
          ].join("\n"),
        );
      }
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      const info = sessionInfo.get(sb.sandboxId);
      if (!info) throw new Error(t("bub.setupNotRun"));
      const { home, workspace } = info;
      const bubHome = `${home}/.bub`;
      // 会话契约:isNew 开新 tape(新 sessionId),否则 resume 传入的 id。
      // tape 路径由 md5(workspace)+md5(sessionId) 决定,同沙箱多会话靠 sessionId 区分。
      const sessionId =
        !ctx.session.isNew && ctx.session.id
          ? ctx.session.id
          : `fe-${sb.sandboxId}-${randomUUID().slice(0, 8)}`;
      ctx.session.id = sessionId;

      const env: Record<string, string> = {
        BUB_API_KEY: getApiKey(),
        BUB_API_BASE: getApiBase(),
        BUB_HOME: bubHome,
        ...ctx.telemetry?.env,
      };
      // model 归属:实验决定(ctx.model),省略时交给 bub 原生默认 / 用户环境,不硬编码。
      if (ctx.model) env.BUB_MODEL = `openai:${ctx.model}`;
      const res = await sb.runShell(
        `${BUB} --workspace ${workspace} run ${shared.shellQuote(input.text)} --session-id ${sessionId}`,
        { env, stream: true },
      );

      const raw = await sb.readFile(tapePath(workspace, sessionId, bubHome)).catch(() => undefined);
      const parsed = shared.parseBub(raw);
      const events = [...parsed.events];
      if (res.exitCode !== 0) events.push({ type: "error", message: shared.diagnoseFailure(res, parsed.events, raw) });
      return { events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
    },
  });
}

export default bubAgent();
