# 配置 Coding Agent 扩展

Claude Code、Codex CLI 和 Bub 的 Adapter factory 可以在每个 attempt 开始前安装 Skills、MCP servers 和各自的原生扩展；Claude Code 与 Codex 还可以安装各自的官方原生配置文件。扩展与配置文件作为 Agent 构造参数进入 experiment，便于组织可复现的 A/B 对比。

## 安装本地 Skill

```ts
import { codexAgent } from "niceeval/adapter";

const agent = codexAgent({
  skills: [
    { kind: "local", path: "skills/effect-ts/SKILL.md" },
    { kind: "local", path: "skills/repository-guide.md", name: "repository-guide" },
  ],
});
```

`path` 相对运行 niceeval 的项目根。Adapter 将内容写到目标 Agent 能发现的位置；路径不存在或内容无法安装时，attempt 在 setup 阶段报错。

## 安装 Repo Skill

```ts
const agent = claudeCodeAgent({
  skills: [{
    kind: "repo",
    source: "Effect-TS/skills",
    ref: "8f3c1a2",
    skills: ["effect", "effect-sql"],
  }],
});
```

外部 Skill 建议固定 `ref`。仓库包含多个 Skill 时显式填写 `skills`；指定不存在的名称或无法解析多 Skill 仓库时，setup 失败并列出可选项。

## 添加 MCP Server

```ts
const browser = {
  name: "browser",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-browser"],
  env: { BROWSER_MODE: "headless" },
};

const claude = claudeCodeAgent({ mcpServers: [browser] });
const codex = codexAgent({ mcpServers: [browser] });
```

MCP 只在 factory 构造时传入。需要条件变体时包装 factory 并合并数组，不在 Agent 构造后修改配置文件。

## 使用官方原生配置文件

原生配置保留官方文件格式，不改写成 TypeScript 对象。先在项目里准备完整配置文件：

`configs/claude-code/no-web.json`：

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": { "deny": ["WebSearch", "WebFetch"] }
}
```

`configs/codex/no-web.toml`：

```toml
#:schema https://developers.openai.com/codex/config-schema.json
web_search = "disabled"
```

再把路径交给各自的 factory：

```ts
const claude = claudeCodeAgent({
  settingsFile: "configs/claude-code/no-web.json",
});

const codex = codexAgent({
  configFile: "configs/codex/no-web.toml",
});
```

`settingsFile` 和 `configFile` 是运行 niceeval 的机器上的本地文件路径，不是 Sandbox 内路径；它们相对本地 niceeval 项目根解析，分别指向完整的 Claude Code `settings.json` 与 Codex `config.toml`。字段只接受项目根内的相对路径：`configs/codex/no-web.toml` 与 `./configs/codex/no-web.toml` 合法，包含 `..` 的路径、绝对路径、`~` 路径和解析后逃出项目根的符号链接都在 setup 阶段报错。

项目根是执行 niceeval 时的当前工作目录，也就是包含 `niceeval.config.ts` 的目录；路径不相对 Eval、Experiment 或声明 Agent 的源码文件。文件可以分开放置：

```text
my-evals/
├── niceeval.config.ts
├── evals/web/search.eval.ts
├── experiments/web/no-search.ts
└── configs/codex/no-web.toml
```

即使 `codexAgent` 写在 `experiments/web/no-search.ts`，仍使用 `configFile: "configs/codex/no-web.toml"`，不写相对源码文件的 `../../configs/...`。项目根外的配置先复制到项目内再引用。

Adapter 先从本地读取原始字节，再上传到 Sandbox 的隔离 Agent 配置目录。它不继承宿主机的 `~/.claude/settings.json` 或 `~/.codex/config.toml`；传入文件原样替换 Sandbox 中原本为空的用户配置层，不做字符串拼接、deep merge 或重新序列化。仓库自己的项目级配置仍由被测 CLI 按官方优先级读取。

model、鉴权、MCP 和 OTel 导出由 experiment 与 Adapter 通过独立配置层或 CLI 参数叠加，对应的键不允许出现在原生配置文件里，冲突在 setup 阶段报错，不做静默覆盖。配置文件内容的 SHA-256 进入安装 checkpoint key；secret 走环境变量，不写进配置文件。每个 Agent 的保留键清单见页尾链接的各 Agent 页。

上例两边都关掉内置联网检索：评测答案能被搜到时，联网会污染通过率。注意原生配置只能关掉 Agent 的检索工具，挡不住它用 shell 命令访问网络；更强的网络隔离属于 Sandbox 层。

## 组织 A/B 实验

```ts
// experiments/skills/baseline.ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: codexAgent(),
  runs: 5,
  earlyExit: false,
});
```

```ts
// experiments/skills/with-review-skill.ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: codexAgent({
    skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
  }),
  runs: 5,
  earlyExit: false,
});
```

两个文件位于同一个 `experiments/skills/` 目录，因此组成一组可对比实验。每个文件只默认导出一个 `defineExperiment`；niceeval 不读取 `export const experiments = { ... }` 这种聚合导出。

model、reasoning effort 和业务 flags 仍由 experiment 配置；扩展内容属于 Agent 变体。评估通过率分布时设置 `earlyExit: false`，避免首次通过后提前停止剩余 runs。

## 查看安装结果

Sandbox Agent setup 写出安装 manifest，attempt 结果保存实际安装的 Skill、来源、ref、插件、解析版本，以及原生配置文件的项目相对路径与 SHA-256；manifest 不保存配置文件正文。安装失败属于基础设施错误，不记作 Agent 解题失败。

每个 Agent 支持的字段和示例见：

- [Claude Code](../sdk/claude-code/README.md)
- [Codex CLI](../sdk/codex-cli/README.md)
- [Bub](../sdk/bub/README.md)
