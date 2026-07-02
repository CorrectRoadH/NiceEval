# Repository Guidelines

## Project Structure & Module Organization

niceeval 是一个 TypeScript evals 库。CLI 入口在 `bin/niceeval.mjs`，运行时通过 `tsx` 直接加载 `src/cli.ts` 和用户项目里的 `.ts` 配置 / eval 文件。核心实现位于 `src/`：类型契约在 `src/types.ts`，定义 API 在 `src/define.ts`，运行器在 `src/runner/`，评分器在 `src/scoring/` 与 `src/expect/`，执行上下文在 `src/context/`，可观测性在 `src/o11y/`，沙箱后端在 `src/sandbox/`，本地结果查看器在 `src/view/`。产品站点位于 `site/`，Mintlify 文档站位于 `docs-site/`，可运行示例位于 `examples/`。

## Documentation Index

项目文档位于 `docs/`，主要是给 Agent 与开发者看的，讨论应该如何设计。先读 `docs/README.md`——它按意图(建立心智模型 / 写 eval / 接 agent / 跑与看 / 背景调研)索引了全部文档；在这里维护第二份清单容易和它脱节，改文档结构时更新那一份即可。找实现行为对应的源码入口，优先查 `docs/source-map.md`。标了"设计提案(未实现)"的文档(如 `docs/multi-agent.md`、`docs/capabilities-by-construction.md`、`docs/adapters/otel-mixin.md`)是未落地的设计，不要当成当前行为。

用户文档位于 `docs-site`，主要是给用户看的。用户应该如何使用 niceeval

## Public Docs, Examples & README

公开文档有三层，更新时要保持一致：

- `docs-site/`：Mintlify 官网文档。`docs-site/docs.json` 管导航；顶层 `*.mdx` 是英文入口；`docs-site/zh/` 是中文入口、指南、参考和场景示例。
- `examples/`：可运行示例。当前完整示例在 `examples/zh/`，文档或 README 链接示例时必须指向真实目录。
- `README.md` / `README.zh.md`：仓库首页文案。只放稳定、短路径信息；详细教程链接到 `docs-site/` 或 `docs/`。

中文内容是产品叙事和场景示例的准绳。更新英文 README、英文 docs-site 或示例索引时，如果发现与中文 README、`docs-site/zh/`、`examples/zh/` 不一致，先按中文和当前代码核对，再把其它语言/入口同步过去；不要为了英文入口临时发明新的能力、路径或产品定位。

## Architecture Boundaries

保持 core 中立。core 负责 eval 发现、断言收集、评分判决、并发调度、缓存、报告和工件。`Agent` / Adapter 负责“连到哪个被测对象、协议怎么说”；`Sandbox` 负责“在哪里跑、如何隔离”。CLI、配置 schema、注册表可以按名字路由；运行器、评分、报告这些核心路径不要写 `agent == codex` 或 `sandbox == docker` 之类的行为分支。需要差异行为时，放到对应 Adapter、Sandbox 或中性的 hook。

## Build, Test, and Development Commands

- `pnpm install`：安装依赖。
- `pnpm run typecheck`：运行 TypeScript 类型检查。
- `pnpm run niceeval -- --help`：通过本地入口冒烟 CLI。
- `pnpm run site:dev`：启动产品站点开发服务器。
- `pnpm run site:build`：构建产品站点。
- `PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate`：验证 Mintlify 文档构建。
- `PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links`：检查 Mintlify 文档 broken links、anchors 和 redirects。

改 `src/` 或 `bin/` 后至少跑 `pnpm run typecheck`。改 `site/` 后至少跑 `pnpm run site:build`。改 CLI 行为后，用 `pnpm run niceeval -- <命令>` 做对应冒烟。
改 `docs-site/` 后至少跑 `docs:validate` 和 `docs:links`；Mintlify CLI 目前需要 LTS Node，例如 Node 22。

## Site
如果开发 Landing Page 用的是 NextJS
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the docs in `node_modules/next/dist/docs/` before coding.
<!-- END:nextjs-agent-rules --> 


## Coding Style & Naming Conventions

项目使用 ESM + TypeScript，公共类型优先放在 `src/types.ts`，公共 API 从 `src/index.ts` 或现有子路径导出。沿用现有模块边界，不为单个 case 提前抽象新层。错误信息要直接说明问题和下一步，尤其是 CLI、配置和 eval 发现错误。注释可以用中文，但只解释不显然的设计约束或复杂流程。

## CLI Model

CLI 只有两类输入：位置参数选择“跑哪些 eval”（eval id 前缀），flag 选择“对着哪个 agent、怎么跑”。不要把 agent 名字、URL 或运行配置混进位置参数语义里；新增命令或报错时保持这个模型清晰。

## Git & Collaboration

直接在 `main` 上开发，不要为改动新建 feature 分支；若已有分支则合回 `main`。

不要用 `git reset --hard`、`git clean`、`git checkout -- <path>` 或 `git restore` 去丢弃工作树改动，除非用户明确要求。工作树里出现你没写的改动时，把它当成用户或其他 agent 的工作，不要覆盖。提交前用 `git status` 和 `git diff` 确认只包含本次任务相关文件。

## 记录问题的规范

发现基础设施 bug、API 限制或行为反直觉的地方时，记入 `memory/`（项目根目录下的 `memory/` 文件夹），不写进本文件。

一条有效的 memory 条目包含三个部分：

- **现象**：出现什么错误、在哪个 eval / sandbox / agent 上复现
- **根因**：为什么会这样（代码假设、API 限制、路径 hardcode 等）
- **修法**：怎么改，以及哪些场景适用

发现问题后立刻记，趁上下文还在。修法有反直觉之处（比如「调大 timeout 反而让 session 更短」）时尤其要记。
