import { defineConfig } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";

export default defineConfig({
  name: { "zh-CN": "e2e: codex(沙箱型内置 agent,docker)", en: "e2e: codex (built-in sandbox agent, docker)" },
  judge: { model: "gpt-5.4" },
  // 默认镜像(node:24-slim)够用,这套 eval 不需要 python3。
  sandbox: dockerSandbox(),
  // 沙箱型 agent 每个 attempt 都是全新容器,要重装 CLI(+ setup 阶段的 skills/MCP);
  // 实测本机(Apple Silicon 下 amd64 镜像走模拟)单次 attempt 数十秒到几分钟,10 分钟放足余量。
  timeoutMs: 600_000,
  maxConcurrency: 2,
});
