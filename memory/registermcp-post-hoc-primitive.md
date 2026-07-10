# `shared.registerMcp`:后置追加 MCP 的原语落地(候选项定案)

**决定**(2026-07-10):`claudeCodeAgent` / `codexAgent` 的构造期 `mcpServers` 选项之外,新增 `shared.registerMcp(agent, servers): Agent`(`src/agents/shared.ts`),给已经构造好的 sandbox agent 后置追加 MCP server。这是此前一直标记"仍然开着"的候选项——条件包装器(如"只在某个实验变体上多挂一个 MCP server")此前只能手写 `{ ...baseAgent, async setup(sb, ctx) { ... } }` 去拼配置文件,拼的时候会重新踩一遍两家 CLI 已经踩过的坑(claude-code 是 `~/.claude.json` 不是 `~/.claude/claude.json`;codex 是复数 `mcp_servers` 不是单数)。

**Why**:`Agent`/`SandboxAgentDef` 没有可变的 option bag(`src/agents/types.ts`),`setup` 是闭包,构造之后无法"追加一个字段"——唯一的扩展方式是产出一个新 `Agent`(spread + 包装 `setup`)。这个模式已经在 `docs/adapters/coding-agent-skills-plugins.md`("当前示例如何演进"一节)里被认可为过渡写法,`registerMcp` 就是把这个手写模式收编成一个不需要知道两家 CLI 配置文件格式的原语,同时是未来 `PluginSpec`(`kind: "mcp"`)迁移时的底层写入实现——不是与之竞争的另一套设计。

**行为要点**:
- 按 `agent.name` 分发(`"claude-code"` / `"codex"`),不认识的 agent(`"bub"`,没有 MCP 概念)或 `agent.kind !== "sandbox"`(remote 型,没有沙箱可写)在**调用 `registerMcp` 时立即** `throw`——不是等到 setup 阶段才炸,失败反馈前移到 experiment 定义处。
- claude-code 侧不是简单覆写:`setup` 读回已有 `~/.claude.json`(可能是 base agent 构造期自己写的)做 JSON 合并,再整份重写——否则后置追加会把 agent 自带的 `mcpServers` 覆盖掉,顺序敏感的 bug 极难在 e2e 里复现(取决于 wrapper 顺序)。
- codex 侧本来就是追加写(`cat >>`),`appendFile`(新增的 `shared` 通用原语,复用 `writeFile` 的随机定界符 heredoc 写法)直接接力,构造期 `mcpServers` + 多次 `registerMcp` 天然叠加,不用特殊处理。
- 传空数组时原样返回传入的 `agent`(no-op,不产生一次多余的 `setup` 包装)。

**代码结构**:`src/agents/shared.ts` 新增 `appendFile` / `writeClaudeMcp` / `writeCodexMcp` / `MCP_WRITERS` / `registerMcp`,`registerMcp` 挂到 `shared` 对象上(随 `niceeval/adapter` 导出)。i18n key `agent.registerMcpNotSandbox` / `agent.registerMcpUnsupported`(`src/i18n/{zh-CN,en}.ts`)。单测 `src/agents/shared.test.ts`(用手写 fake `Sandbox`,`runShell` 里正则解析 heredoc 落到内存文件表,断言 claude-code 合并写入、codex 追加写入、fail-fast 两条路径、空数组 no-op)。

**未做的事**(有意不做,避免范围膨胀):没有把 `claude-code.ts` / `codex.ts` 构造期 `mcpServers` 的写入逻辑重构成调用 `writeClaudeMcp`/`writeCodexMcp`——两处逻辑当前是重复的(格式一致,~15 行),但这两个文件已经过 e2e 验证(`e2e/projects/{claude-code,codex}/evals/feature-mcp-tool.eval.ts`),不在本次改动范围内触碰以降低风险。如果两处格式将来出现漂移(比如 codex CLI 改了 TOML 表名),两处都要改——下次touch这两个文件时可以顺手做这个重构。

**改动范围**:`src/agents/shared.ts`、`src/agents/shared.test.ts`(新增)、`src/i18n/{zh-CN,en}.ts`、`docs/adapters/coding-agent-skills-plugins.md`(新增"后置追加"小节 + 修正两处过期的 MCP 写入路径/表名)、`docs/adapters/authoring.md`(shared 工具袋清单)、`docs/source-map.md`、`docs-site/zh/guides/official-adapters.mdx`(新增"后置追加 MCP server"小节)。验证:`pnpm run typecheck` / `pnpm test`(313 通过)/ `pnpm run docs:validate` / `pnpm run docs:links` 全绿。

关联:[[mcp-tool-naming-claude-vs-codex]](同样是 MCP 相关的两家 CLI 差异,那条记录的是断言层的坑,这条记录的是构造/组合层的坑)。
