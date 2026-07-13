# Bub

使用 `bubAgent` 在 Sandbox 中安装并运行 Bub。

```ts
import { bubAgent } from "niceeval/adapter";

const agent = bubAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
  pythonPlugins: [
    { package: "acme-bub-tools==1.4.0" },
  ],
});
```

Bub 支持 `skills` 和 `pythonPlugins`，不接受 Claude/Codex 的 `mcpServers` 或原生 `plugins` 字段。Python package 集合属于安装 checkpoint key，配置变化必须触发重新安装。

行为轨来自 Bub tape JSONL；session 由 Adapter 管理。缺少显式 call ID 的旧事件只能按位配对，因此并发工具完整性取决于原始 tape 是否提供稳定关联字段。Usage 和 cost 从 run 事件读取。

Bub 原生 OTLP 可以配置为时间轨，span mapper 只影响瀑布图。
