# 同形的两个具名 Spec，TypeScript 拦不住互换——「类型层拒绝」不能这么承诺

**现象**:`docs/feature/adapters/coding-agent-skills-plugins.md` 的设计规则 5 曾写「`ClaudeCodePluginSpec` 不能传给 Codex，`CodexPluginSpec` 不能传给 Claude Code」。实现时发现这句做不到。

**根因**:**TypeScript 是结构类型系统**。`ClaudeCodePluginSpec` 与 `CodexPluginSpec` 的字段形状当时完全相同(`marketplace: { name, source, ref? }` + `name`),同形即互相可赋值——**给类型起两个不同的名字,本身不产生任何拒绝**。想真的拦住,只能加判别字段(各自必填 `agent: "claude-code"` / `"codex"`)或品牌化(`__brand`)。

**修法**(2026-07-12,改文档不改类型):

- **不加冗余判别字段**。归属已经由**字段位置**声明了——`plugins` 写在 `claudeCodeAgent({…})` 里就是 Claude Code 的;再塞一个 `agent: "claude-code"` 是纯仪式,用户要写两遍同一件事。
- **两个类型仍然分开**。不是为了让编译器拒绝互换,而是因为两家的安装机制与 Marketplace 语义本就不同、且会继续分化(Codex 的 Marketplace 连接收 `--ref`,Claude Code 的不收——分化已经发生了)。
- **文档改成说实话**:类型层负责的是「**不支持的能力根本不存在**」(Bub Config 没有 `mcpServers` / `plugins`,Claude Code 与 Codex Config 没有 `pythonPlugins`——这类无效组合确实编译不过);类型层**不**负责拦住「把只有 Codex 能读的 Marketplace 递给 Claude Code」——那是 `source` 的**值**不合法,不是形状不合法,装不上时由该 Adapter 报错。

**教训**(可复用):写「无效组合在类型层拒绝」这类契约前,先分清要拦的是**形状**还是**值**。结构类型只拦形状;值的合法性(URL 指向谁、名字对不对)永远得留到运行期。名字不同 ≠ 类型不同。
