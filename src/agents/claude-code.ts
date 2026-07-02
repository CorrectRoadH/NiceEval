import { defineSandboxAgent } from "../define.ts";
import { requireEnv, getEnv } from "../util.ts";
import { shared } from "./shared.ts";
import type { Agent, McpServer } from "../types.ts";

// ───────────────────────────────────────────────────────────────────────────
// Claude Code 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `claude` CLI,跑完读回 transcript JSONL → 标准事件流。
// ───────────────────────────────────────────────────────────────────────────

export interface ClaudeCodeConfig {
  /** Anthropic API key。省略时读 ANTHROPIC_API_KEY env。 */
  apiKey?: string;
  /**
   * 自定义 API base URL(代理 / 内网端点)。省略时读 ANTHROPIC_BASE_URL env;
   * 两者都没有则用 Anthropic 官方端点(claude CLI 默认行为)。
   */
  baseUrl?: string;
  /**
   * 最多跑几个 tool-use 轮次(→ `--max-turns`)。
   * 控制 eval 成本上限;省略时用 CLI 原生默认(无限制)。
   */
  maxTurns?: number;
  /**
   * 额外 MCP server(每个沙箱 setup 时写进 ~/.claude/claude.json)。
   * 示例:{ name: "browser", command: "npx", args: ["-y", "@anthropic/mcp-browser"] }
   */
  mcpServers?: McpServer[];
  /**
   * 额外安装的 skill，格式为 GitHub `"org/repo"`（如 `"Effect-TS/skills"`）。
   * setup 阶段在沙箱里执行 `npx skills add <org/repo>`；
   * 结果写进沙箱工作区的 skills-lock.json，claude CLI 启动时自动读取。
   *
   * @example skills: ["Effect-TS/skills"]
   */
  skills?: string[];
}

export function claudeCodeAgent(config?: ClaudeCodeConfig): Agent {
  const getApiKey = () => config?.apiKey ?? requireEnv("ANTHROPIC_API_KEY");
  const getBaseUrl = () => config?.baseUrl ?? getEnv("ANTHROPIC_BASE_URL");

  return defineSandboxAgent({
    name: "claude-code",
    capabilities: { conversation: true, toolObservability: true, workspace: true, compactionObservability: true },

    async setup(sb) {
      // 预制模板已把 claude 烘焙进镜像(PATH 上)就跳过安装;否则 npm 全局装。
      await sb.runShell("command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code");

      if (config?.mcpServers?.length) {
        const servers: Record<string, object> = {};
        for (const s of config.mcpServers) {
          servers[s.name] = {
            command: s.command,
            ...(s.args?.length && { args: s.args }),
            ...(s.env && { env: s.env }),
          };
        }
        await shared.writeFile(sb, "~/.claude/claude.json", JSON.stringify({ mcpServers: servers }, null, 2));
      }

      if (config?.skills?.length) {
        for (const source of config.skills) {
          // source = "Effect-TS/skills"（GitHub org/repo）
          // `npx skills add` 拉 repo、读 manifest、写 skills-lock.json，claude CLI 自动读取。
          await sb.runShell(`npx skills add ${source}`);
        }
      }
    },

    async send(input, ctx) {
      const sb = ctx.sandbox;
      const args = ["--print", "--dangerously-skip-permissions"];
      if (ctx.model) args.push("--model", ctx.model);
      if (config?.maxTurns != null) args.push("--max-turns", String(config.maxTurns));
      if (ctx.flags.webResearch) args.push("--allowedTools", "WebSearch,WebFetch");
      if (!ctx.session.isNew && ctx.session.id) args.push("--resume", ctx.session.id);
      args.push(input.text);

      const env: Record<string, string> = { ANTHROPIC_API_KEY: getApiKey() };
      const baseUrl = getBaseUrl();
      if (baseUrl) env["ANTHROPIC_BASE_URL"] = baseUrl;

      const res = await sb.runCommand("claude", args, { env, stream: true });

      // resume 轮已知 session id → 精确定位 transcript;首轮退化到「最新 jsonl」。
      const knownId = !ctx.session.isNew && ctx.session.id ? ctx.session.id : undefined;
      const raw = await shared.captureLatestJsonl(sb, "~/.claude/projects", knownId);
      ctx.session.id = shared.sessionIdFromClaudeTranscript(raw) ?? ctx.session.id;
      const parsed = shared.parseClaudeCode(raw);
      const events = [...parsed.events];
      if (res.exitCode !== 0) events.push({ type: "error", message: shared.diagnoseFailure(res, parsed.events, raw) });
      return { events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
    },
  });
}

export default claudeCodeAgent();
