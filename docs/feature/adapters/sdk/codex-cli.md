# Codex CLI

使用 `codexAgent` 在 Sandbox 中安装并运行 Codex CLI。

```ts
import { codexAgent } from "niceeval/adapter";

const agent = codexAgent({
  skills: [{ kind: "repo", source: "acme/codex-skills", ref: "v2" }],
  mcpServers: [{ name: "browser", command: "npx", args: ["-y", "server"] }],
  plugins: [{
    // name 必须等于 acme/codex-plugins 仓库 manifest 里声明的 name,不是随意起的别名
    marketplace: { name: "acme-plugins", source: "acme/codex-plugins", ref: "v2" },
    name: "repo-map",
  }],
});
```

Codex Adapter 把 Skills 写到可发现目录并提供稳定发现指引；不能假设存在与 Claude Code Skill Tool 相同的自动加载事件。验证 Skill 使用时检查读取行为或 Skill 特有结果。

行为轨来自 `codex exec --json` 的结构化 stdout，session ID 来自 thread started 事件；工具调用优先按显式 call ID 配对。实际模型可能被网关改写，需要时从 Codex session 侧写读取，不能只信请求参数。

Codex 原生 Plugin 使用 Codex 专属 factory 字段。Codex SDK 的服务接入是另一种形态，见 [Codex SDK](codex-sdk.md)。
