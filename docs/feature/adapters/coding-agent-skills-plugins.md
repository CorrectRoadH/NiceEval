# Coding Agent Skills / Plugins

沙箱型 Coding Agent Adapter 负责在每个 Attempt 的 setup 阶段安装 Skill、MCP Server 或 Agent 专属扩展。Experiment 通过构造不同的 Agent 变体，比较这些上下文与工具是否提高通过率、质量或成本效率。

## 概念边界

- **Skill** 是模型上下文：项目约定、领域知识、API 指南或解决任务的方法。
- **Native Plugin** 是 Claude Code 或 Codex 从自己的 Marketplace 安装的扩展。
- **MCP Server** 是 Claude Code 与 Codex 可连接的工具服务，不等同于 Native Plugin。
- **Python Plugin** 是 Bub 运行环境中的 Python Package。

这些扩展没有共同安装协议。NiceEval 不提供跨 Agent 的统一 `PluginSpec`：Claude Code 与 Codex 各自拥有 Adapter 专属的 Plugin 类型，Bub 使用 Python Plugin，MCP 保持独立。具体字段放在支持它的 Adapter Config 上，让 TypeScript 在构造期拒绝无效组合。

## 设计规则

1. **Experiment 决定安装内容。** Skill、Native Plugin、MCP 与 Python Plugin 是 Agent 构造参数，不是 CLI 位置参数或项目级全局开关。
2. **Adapter 翻译配置。** Core 不知道 Claude Code、Codex 或 Bub 的配置目录与安装命令。
3. **每个 Attempt 只安装一次。** 安装发生在 `Agent.setup`，早于第一次 `send`；多轮对话不重复安装。
4. **来源必须可复现。** Repo Skill 可固定 ref，多 Skill Repo 必须明确选择启用集合。
5. **不支持的能力在类型层就不存在。** 一个 Agent 支持哪几类扩展，由它的 Config 上有哪些字段表达：Bub Config 没有 `mcpServers` 与 `plugins`，Claude Code 与 Codex Config 没有 `pythonPlugins`。这类无效组合写出来就编译不过，不留到运行期 fail fast。

   两家的 Native Plugin 各有各的类型（`ClaudeCodePluginSpec` / `CodexPluginSpec`），因为两家的安装机制与 Marketplace 语义本就不同、且会继续分化（Codex 的 Marketplace 连接收 `--ref`，Claude Code 的不收）。但**类型系统不负责拦住「把只有 Codex 能读的 Marketplace 递给 Claude Code」**：那是 `source` 字段的**值**不合法，不是形状不合法，任何结构类型系统都判不出来——两个 Spec 的字段形状相同时，TypeScript 认为它们可以互相赋值，改不了。归属由**字段位置**声明（`plugins` 写在 `claudeCodeAgent({…})` 里就是 Claude Code 的），装不上时由该 Adapter 报错。
6. **安装结果可审计。** setup 写出安装 Manifest，失败时能够判断实际装了什么。

## SkillSpec

Claude Code、Codex 与 Bub 共用 Skill 的来源描述：

```ts
type SkillSpec =
  | {
      kind: "local";
      /** 相对项目根的 Skill 文件或目录。 */
      path: string;
      /** 展示名；省略时由文件或目录名推导。 */
      name?: string;
    }
  | {
      kind: "repo";
      /** GitHub owner/repo 或 Git URL。 */
      source: string;
      /** 多 Skill Repo 中要启用的 Skill。 */
      skills?: string[];
      /** Tag、Commit 或 Branch。 */
      ref?: string;
    };
```

Adapter Config 使用同一个字段：

```ts
interface ClaudeCodeConfig {
  skills?: SkillSpec[];
  plugins?: ClaudeCodePluginSpec[];
  mcpServers?: McpServer[];
}

interface CodexConfig {
  skills?: SkillSpec[];
  plugins?: CodexPluginSpec[];
  mcpServers?: McpServer[];
}

interface BubConfig {
  skills?: SkillSpec[];
  pythonPlugins?: PythonPluginSpec[];
}
```

`SkillSpec` 只统一“从哪里取得哪份 Skill”。安装位置、发现机制与是否需要额外 Project Instruction 由 Adapter 决定。

## 本地 Skill

本地 Skill 是 Eval Project 的签入内容：

```ts
import { codexAgent } from "niceeval/adapter";

const agent = codexAgent({
  skills: [
    { kind: "local", path: "skills/effect-ts/SKILL.md" },
    { kind: "local", path: "skills/repository-guide.md", name: "repository-guide" },
  ],
});
```

Adapter 从运行 NiceEval 的项目根读取 `path`，把内容写入沙箱中该 Agent 能发现的位置。路径不存在、指向不支持的形状或内容无法写入时，setup 失败。

不同 Agent 的注入方式可以不同：

| Agent | Adapter 义务 |
|---|---|
| Claude Code | 写入 Claude Code 的 Project Instruction 或原生 Skill 目录 |
| Codex | 写入 Codex 可发现的 Skill 目录，并提供让 Codex 检查 Skill 的 Project Instruction |
| Bub | 写入 Bub 支持的项目说明或 Skill 目录 |

Codex 没有与 Claude Code Skill Tool 等价的自动加载机制。仅把文件装到 `.agents/skills/` 不足以证明 Codex 会读取它；Codex Adapter 必须同时写入稳定的发现指引。Eval 验证 Skill 使用时，应检查读取 Skill 文件的行为证据或 Skill 特有结果，不假设存在固定的 `load_skill` Tool。

## Repo Skill

Repo Skill 用于复用外部 Skill Repository：

```ts
const agent = claudeCodeAgent({
  skills: [
    {
      kind: "repo",
      source: "Effect-TS/skills",
      ref: "8f3c1a2",
      skills: ["effect", "effect-sql"],
    },
  ],
});
```

Adapter 在 setup 阶段调用对应 Installer，并以非交互方式指定目标 Agent。配置语义固定为：

- `source` 决定 Repository。
- `ref` 固定版本；省略表示使用 Repository 默认 ref。
- `skills` 选择要启用的 Skill。

选择规则：

| 输入 | 结果 |
|---|---|
| Repository 只有一个 Skill，省略 `skills` | 安装唯一 Skill |
| Repository 有多个 Skill，省略 `skills` | setup 失败，并列出可选 Skill |
| 指定不存在的 Skill | setup 失败，并报告 source、ref 与 Skill 名 |
| 同名 Skill 来自多个来源 | 按配置顺序安装；Manifest 保留每个来源，不静默合并 |

## MCP Server

MCP 使用已有的 `McpServer`，不包装成通用 Plugin：

```ts
const browser: McpServer = {
  name: "browser",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-browser"],
  env: { BROWSER_MODE: "headless" },
};

const claude = claudeCodeAgent({ mcpServers: [browser] });
const codex = codexAgent({ mcpServers: [browser] });
```

Adapter 分别翻译到原生配置：

| Agent | 写入位置 |
|---|---|
| Claude Code | `~/.claude.json` 顶层 `mcpServers` |
| Codex | `~/.codex/config.toml` 的 `[mcp_servers.<name>]` |

MCP 只有 Adapter Factory 构造期这一条入口。不提供给已构造 Agent 后置追加 MCP 的 API。需要条件变体时，包装 Factory 并合并 `mcpServers`；不要读取 `agent.name` 后修改配置文件。

## Claude Code Native Plugin

Claude Code Plugin 使用 Claude Code 专属类型。每一项同时声明 Marketplace 连接和其中的 Plugin 名：

```ts
interface ClaudeCodePluginSpec {
  marketplace: {
    /** Marketplace 在 Claude Code 配置中的连接名。 */
    name: string;
    /** Marketplace Repository 或 Claude Code 支持的连接来源。 */
    source: string;
    /** 固定 Marketplace 的 Tag、Commit 或 Branch。 */
    ref?: string;
  };
  /** Marketplace 中的 Plugin 名。 */
  name: string;
}
```

```ts
const agent = claudeCodeAgent({
  plugins: [
    {
      marketplace: {
        name: "acme",
        source: "acme/claude-code-plugins",
        ref: "v1.3.0",
      },
      name: "safe-shell",
    },
  ],
});
```

Claude Code Adapter 先以 `marketplace.name` 建立 Marketplace 连接，再从该连接安装 `name` 指定的 Plugin，并把 Marketplace 名、来源、ref、Plugin 名与解析后的版本写入 Manifest。配置只允许显式 Plugin 名；连接 Marketplace 不代表启用其中全部 Plugin。

## Codex Native Plugin

Codex Plugin 有自己的类型——Marketplace 连接收 `ref`，这是 Claude Code 侧没有的：

```ts
interface CodexPluginSpec {
  marketplace: {
    /** Marketplace 在 Codex 配置中的连接名。 */
    name: string;
    /** Codex Marketplace Repository 或 Codex 支持的连接来源。 */
    source: string;
    /** 固定 Marketplace 的 Tag、Commit 或 Branch。 */
    ref?: string;
  };
  /** Marketplace 中的 Plugin 名。 */
  name: string;
}
```

```ts
const agent = codexAgent({
  plugins: [
    {
      marketplace: {
        name: "acme",
        source: "acme/codex-plugins",
        ref: "8f3c1a2",
      },
      name: "repo-map",
    },
  ],
});
```

Codex Adapter 只按 Codex 的 Marketplace 与 Plugin 协议安装。即使 Claude Code 与 Codex 的字段当前相似，也保留两个命名类型：任一 Agent 的 Marketplace 认证、锁文件、选择规则或安装参数变化时，不会迫使另一 Adapter 接受无意义字段。

## Bub Python Plugin

Bub 的扩展使用专属类型：

```ts
interface PythonPluginSpec {
  /** PyPI Package、Version Specifier 或 Git URL。 */
  package: string;
}
```

```ts
const agent = bubAgent({
  pythonPlugins: [
    { package: "bub-plugin-memory==1.3.0" },
    { package: "git+https://github.com/acme/bub-tools.git@8f3c1a2" },
  ],
});
```

Bub Adapter 将 Package 加入 `uv tool install ... --with <package>`，并把规范化后的 Package 列表纳入安装 Checkpoint Key。Plugin 集合不同的两个 Agent 变体不能复用同一个安装 Checkpoint。

## Experiment 中组织 A/B

不用 CLI Flag 临时打开 Skill 或 Plugin。每个变体由独立 Experiment 文件构造：

```text
experiments/
└── skill-ab/
    ├── baseline.ts
    ├── claude-effect.ts
    ├── codex-effect.ts
    └── bub-memory.ts
```

```ts
// experiments/skill-ab/codex-effect.ts
export default defineExperiment({
  description: "Codex with Effect Skill",
  agent: codexAgent({
    skills: [
      {
        kind: "repo",
        source: "Effect-TS/skills",
        ref: "8f3c1a2",
        skills: ["effect"],
      },
    ],
  }),
  model: "gpt-5.4",
  sandbox: dockerSandbox(),
  evals: (id) => id.startsWith("effect/"),
  runs: 3,
  earlyExit: false,
});
```

Experiment ID 表达变体身份；报告按 Experiment、Agent、Model 与 Flags 比较，不要求修改 Agent 的基础名称来编码全部配置。

## 安装 Manifest

每个沙箱型 Adapter 在 setup 完成后写出标准 Manifest：

```ts
interface AgentSetupManifest {
  skills: Array<
    | { kind: "local"; name: string; path: string; sha256: string }
    | { kind: "repo"; source: string; ref?: string; skills: string[] }
  >;
  nativePlugins?: Array<{
    agent: "claude-code" | "codex";
    marketplace: { name: string; source: string; ref?: string };
    name: string;
    resolvedVersion?: string;
  }>;
  mcpServers?: Array<{ name: string; command: string; args?: string[] }>;
  pythonPlugins?: Array<{ package: string }>;
}
```

Manifest 在沙箱中写到 `__niceeval__/agent-setup.json`，并作为 Attempt Artifact 保存为 `agent-setup.json`。它不参与评分，只回答“这次实际安装了什么”。环境变量值与 Secret 不写入 Manifest。

## 失败语义

以下问题发生在 Agent setup，Attempt 判为 `errored`：

- 本地 Skill 路径不存在或无法读取。
- Repo Skill 下载、ref 解析或选择失败。
- Native Plugin 的 Marketplace 连接、Plugin 解析或安装失败。
- MCP Config 无法写入。
- Python Plugin 安装失败。
- Manifest 无法完整反映安装结果。

安装失败不是 Agent 对任务作答后的质量问题，因此不能伪装成 `failed` Verdict、`Turn.status = "failed"` 或 Gate Assertion。

## 架构边界

Core 只调 `Agent.setup`，不解释 `SkillSpec`、MCP Config 或 Python Package。所有 Agent 差异留在对应 Adapter：

- `SkillSpec` 是 Adapter Config 共享的数据类型。
- `ClaudeCodePluginSpec` 与 `CodexPluginSpec` 分别属于对应 Adapter，不存在跨 Agent 的 Plugin 联合。
- `McpServer` 是支持 MCP 的 Adapter Config 类型，不属于 Native Plugin。
- `PythonPluginSpec` 只属于 Bub Config。
- 安装 Manifest 是 setup 的 Artifact，不改变评分语义。

## 相关阅读

- [Adapter Contract](contract.md) —— setup 生命周期与失败边界。
- [Adapter Authoring](authoring.md) —— 如何实现沙箱型 Adapter。
- [Sandbox Hooks](../sandbox/library.md#沙箱生命周期钩子setup--teardown) —— 环境预置与 Agent 构造配置的分工。
- [Experiments](../experiments/README.md) —— 如何组织可比较变体。
