<div align="center">

# fasteval

**给每个项目用的轻量 TypeScript agent evals。**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](docs/README.md)

[English](README.md) · [文档](docs/README.md)

</div>

fasteval 是一个 TypeScript evals 库，用同一套 `defineEval` surface 评测
agents 和 coding-agent fixtures，同时保留面向 services / functions 的 adapter
边界。

你把 eval 写成小 TypeScript 文件，按名字切换被测 agent，然后直接拿到 verdict、
trace、cost、diff、transcript 和 artifacts。不需要每个项目都重新搭一套测试 harness。

```ts
// evals/button.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "实现一个带 label 和 onClick props 的 Button 组件。",
  workspace: "fixtures/button",
  async test(t) {
    await t.send("创建 src/components/Button.tsx，支持 label 和 onClick props。");

    t.succeeded();
    t.fileChanged("src/components/Button.tsx");
    t.check(t.file("src/components/Button.tsx"), includes("onClick"));
    t.testsPassed();
  },
});
```

```sh
npx fasteval button --agent codex --sandbox docker
npx fasteval view
```

## 为什么用 fasteval

agent evals 应该轻到可以直接放在业务代码旁边。fasteval 把心智负担压在几个稳定概念上：

- **一套 eval 写法：** agent conversation 和 coding-agent tasks 都用
  `defineEval`，评分词汇保持一致。
- **按名字切换 agent：** 同一批 eval 可以通过 `--agent <name>` 跑本地、测试、
  线上或不同模型。
- **协议交给 adapter：** fasteval 不强行定义统一 HTTP schema；怎么调用被测对象，
  由你的 adapter 决定。
- **coding task 可进沙箱：** 把 coding agent 放进 Docker workspace，抓 diff，
  跑验证测试，再看 transcript。
- **评分可读：** 同时支持值级 matcher、事件流断言、Vitest 检查和可选
  LLM-as-judge。
- **默认留下工件：** run result、event stream、trace、diff、usage、cost estimate
  和本地 viewer 都围绕排查失败设计。

边界也很清楚：core 负责发现 eval、调度、评分、报告和工件；`Agent` adapter 负责
“怎么连到被测对象”；`Sandbox` backend 负责“在哪里隔离运行”。

## 安装

```sh
npm install -D fasteval
```

本仓库本地开发：

```sh
pnpm install
pnpm run typecheck
```

## 快速开始

先在 `fasteval.config.ts` 里注册一个 sandbox agent。adapter 负责安装和调用
coding-agent CLI，并把 transcript 归一化成 fasteval 的标准事件流。

```ts
// fasteval.config.ts
import { defineConfig } from "fasteval";
import codex from "./agents/codex.ts";

export default defineConfig({
  agents: [codex],
  defaultAgent: "codex",
  sandbox: "docker",
  maxConcurrency: 4,
  timeoutMs: 600_000,
});
```

然后写一个 eval：

```ts
// evals/button.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "实现一个带 label 和 onClick props 的 Button 组件。",
  workspace: "fixtures/button",
  async test(t) {
    await t.send("创建 src/components/Button.tsx，支持 label 和 onClick props。");

    t.succeeded();
    t.fileChanged("src/components/Button.tsx");
    t.check(t.file("src/components/Button.tsx"), includes("onClick"));
    t.testsPassed();
    t.noFailedShellCommands();
  },
});
```

运行：

```sh
npx fasteval button --agent codex --sandbox docker --dry
npx fasteval button --agent codex --sandbox docker
npx fasteval view
```

CLI 模型故意很简单：**位置参数**选择“跑哪些 eval”，**flags** 选择“对着哪个
agent、怎么跑”。agent 名、URL、运行环境这类东西不要塞进位置参数；放到 adapter
或环境变量里。

## Adapter 做什么

sandbox adapter 刻意保持很薄：安装 CLI、准备鉴权、运行 prompt、解析 transcript。
主包导出的共享工具和文档示例会处理重复工作，比如抓 JSONL transcript、
转成标准事件流。

```ts
// agents/codex.ts
import { defineSandboxAgent, shared } from "fasteval";

export default defineSandboxAgent({
  name: "codex",
  async setup(sandbox) {
    await shared.ensureInstalled(sandbox, "npm", ["install", "-g", "@openai/codex"]);
  },
  async send(input, ctx) {
    const run = await ctx.sandbox.runCommand("codex", ["exec", "--json", input.text], {
      stream: true,
    });
    const parsed = shared.parseCodex(run.stdout);
    return {
      status: run.exitCode === 0 ? "completed" : "failed",
      events: parsed.events,
      usage: parsed.usage,
    };
  },
});
```

真实 adapter 可以继续加 model flags、resume、自定义鉴权、OTLP tracing 或
provider-specific transcript lookup。core 不需要知道这些差异。

## 常用命令

```sh
fasteval list                         # 列出发现到的 eval
fasteval --dry                        # 展示会跑什么，不真正执行
fasteval <id-prefix> --agent <name>   # 跑匹配 id 前缀的 eval
fasteval exp [group-or-id]            # 跑签入仓库的实验配置
fasteval view                         # 打开本地结果查看器
fasteval view --out report.html       # 导出静态 HTML 报告
fasteval clean                        # 删除 .fasteval/ 工件
```

常用 flags 包括 `--agent`、`--sandbox`、`--model`、`--runs`、
`--max-concurrency`、`--timeout`、`--strict`、`--quiet` 和 `--dry`。

## Experiments

Experiment 是可以签进仓库的运行矩阵。它描述“用哪些 agent / model / 参数跑这批
eval”，但不改变“怎么算对”。

```ts
// experiments/button.ts
import { defineExperiment } from "fasteval";

export default defineExperiment({
  agent: ["codex-local", "codex-ci"],
  evals: ["button"],
  runs: 5,
  earlyExit: true,
});
```

```sh
npx fasteval exp button
```

## Reporting

控制台会给即时 verdict。默认 artifact reporter 会把结构化结果写到 `.fasteval/`，
供 `fasteval view` 读取。你也可以在 config 里加 reporter：

```ts
import { defineConfig } from "fasteval";
import { Json, JUnit } from "fasteval/reporters";

export default defineConfig({
  reporters: [
    Json(".fasteval/results.json"),
    JUnit(".fasteval/junit.xml"),
  ],
});
```

## Agent Init Guide

如果你想让 AI coding agent 帮另一个仓库接入 fasteval，可以直接给它这段 prompt：

```text
Read https://raw.githubusercontent.com/CorrectRoadH/fasteval/refs/heads/main/INIT.md and initialize fasteval for this repository.
```

这份 guide 会让 agent 先读目标仓库、选一个有价值的 first eval、创建
`fasteval.config.ts`、注册 adapter、补一个最小 eval、跑 dry check，并留下可读文档。

## 核心概念

**Eval** 是描述正确行为的 TypeScript 文件。eval id 从路径推导，比如
`evals/weather/brooklyn.eval.ts` 会变成 `weather/brooklyn`。

**Agent** 是一条按名字选择的被测对象连接。sandbox adapter 决定如何调用
coding-agent CLI，并返回标准事件流。

**Sandbox** 是 coding-agent 工作的隔离环境。当前 Docker backend 已实现，其他后端
可以挂在同一个接口后面。

**Scoring** 把值级断言、事件流断言、Vitest 验证和可选 LLM-as-judge 组合成最终判决。

**Artifacts** 让失败可解释：transcript、event stream、diff、assertions、usage、
cost estimate 和 trace 都可以留下来。

## Roadmap

- 更短的 onboarding：`fasteval init`、模板和示例 adapter。
- 常见 coding-agent CLI 的维护版 adapter packs。
- 更完整的 `defineAgent` remote / in-process runner 路径。
- watch mode、fingerprint cache、changed-only rerun 和 force rerun。
- 更多 sandbox backends，包括 Vercel Sandbox 和项目自有 provider。
- 更完整的 CI flags：JSON/JUnit 输出、budget、tag、smoke run。
- 更强的 `fasteval view`：transcript、trace、diff、实验对比。

## 文档

- [文档首页](docs/README.md)
- [Getting Started](docs/getting-started.md)
- [Authoring](docs/authoring.md)
- [Scoring](docs/scoring.md)
- [Agents and Adapters](docs/agents-and-adapters.md)
- [Sandbox](docs/sandbox.md)
- [Runner](docs/runner.md)
- [Experiments](docs/experiments.md)
- [Observability](docs/observability.md)
- [CLI](docs/cli.md)
- [Source Map](docs/source-map.md)

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run site:build
```

改 `src/` 或 `bin/` 后跑 `pnpm run typecheck`。改产品站点后跑
`pnpm run site:build`。CLI 行为建议在带 `fasteval.config.ts` 的 fixture 或目标仓库
里 smoke test。
