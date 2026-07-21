# Handoff：E2E 矩阵按验收域契约落地

契约已定稿并提交（`fcde655` → `06f941e`）：`docs/engineering/testing/e2e/README.md`（总则：独立测试仓库、e2e.json、统一执行协议、候选包注入、CLI 读回、编排、CI/crabbox、守护）、`adapters/README.md` + 10 篇适配器评估计划、`report.md`（results-contract）、`cli.md`（cli-contract）、`verification.md`（验收脚本写法与断言用例）。实现一律以这些 docs 为准，不从现有 `e2e/` 反推。

**现有 `e2e/` 是被契约否决的旧布局**（中央 `apps/` + `projects/` + `shared/`，见总则「不做的事」）。旧目录里的被测应用与 Eval 语义可以搬进对应新仓库作起点，但搬完必须满足自治约束（自带 lockfile、无跨仓库 import、无父目录 `file:` 依赖）；`shared/` 整体废弃，不允许换个名字复活。

## 0. 前置：核对验收依赖的 CLI 行为（先做，阻塞其它一切）

`verification.md` 的断言依赖以下可观察行为，逐条在真实 eval 仓库（如 `/Users/ctrdh/Code/coding-agent-memory-evals`）用 `pnpm exec niceeval ...` 核对与 docs 预期一致；缺的先补实现（各自契约页为准），否则后面所有 verify 脚本都是空转：

- `show <evalId> --history`：每 attempt 一行，行含 verdict 与 `@locator`（`docs/feature/reports/show.md`）。
- `show @<locator> --execution`：TOOL 卡片带 `input` 块与工具名；无关联 span 时时间注释显示 timing unavailable（`docs/feature/reports/show/execution.md`）。
- `show @<locator> --timing`：runner 时间树 + 按 traceId 挂 OTel model/tool 子树（`docs/feature/reports/show/timing.md`）。
- `exp --junit`：`failed → <failure>`、`errored → <error>` 互斥折叠（`docs/observability.md`）。
- `exp --output ci`：start 行带缓存复用摘要（`reused`）、errored 行可辨识 provider 错误（`docs/feature/experiments/cli.md`）。
- `t.calledTool(name, { input })` 深度部分匹配（`docs/feature/scoring/library/scoped-assertions.md`）。

## 1. 根编排层（一个 agent）

落点 `e2e/scripts/list.ts`、`e2e/scripts/run.ts`（tsx 执行），职责边界严格按总则 §5：

- `list.ts`：发现 `e2e/adapter/*/e2e.json`，校验 schema 与 id 唯一。
- `run.ts`：`pnpm pack` 构建一次候选 tarball → 按 `--repo <id>` / `--group <sdk|sandbox|contract>` 选仓库 → 逐仓库隔离工作目录（复制到临时目录）→ 注入候选包 + 按 `e2e.json.secrets` 最小注入环境 → spawn `command` → **注入核验**（解析到的 niceeval 指纹 ≠ 候选 tarball 则作废按 infra 处理）→ 退出码 `75` 整仓库重跑一次 → 原样汇总退出码与失败类别、收集 `artifacts`。
- 根 `package.json` 加 `"e2e": "tsx e2e/scripts/run.ts"`。
- 编排器不得内置 SDK 名、端口、Eval 数、verdict 期望，不读 `.niceeval/`。

## 2. 结构守护（一个 agent，可与 1 并行）

落点 `test/e2e-structure.test.ts`（进 `pnpm test`，不新增脚本/hook），按总则 §8 逐条：e2e.json 合法且 id 唯一；每仓库有自己的 Eval/Experiment、lockfile、`.env.example`、`.gitignore`（含 `.niceeval/`）；无跨测试仓库 / 父级 `src/` import；manifest 无父目录 `file:`/`link:`；根编排脚本文本不含 Eval ID / expected count / 协议工具名。

## 3. contract 仓库先行（一个 agent；先绿再放行 4）

- `e2e/adapter/results-contract/`：按 `report.md` 四出口验收——落盘文件逐字段（依据 `docs/feature/results/architecture.md`）、`openResults()` 与盘上一致、`--json` 口径、`--junit` 折叠。**全矩阵唯一允许 import `niceeval/results` 的仓库。**
- `e2e/adapter/cli-contract/`：按 `cli.md`——选择器命中/未命中反馈、正常 / deliberate-fail / deliberate-error 三 Experiment 的退出码折叠、缓存三步。verify 写法直接抄 `verification.md` 用例六、七。

## 4. 适配器仓库 ×10（每仓库一个 agent，可全部并行）

每仓库按对应评估计划页实现，骨架统一（总则 §2.2）：`package.json`+lockfile、`e2e.json`、`niceeval.config.ts`、`src/`（被测应用，无服务仓库省略）、`agents/`、`evals/`、`experiments/`、`scripts/e2e.ts` + `verify.ts`（写法照 `verification.md`：shell 原文、`node:assert/strict`、CLI 黑盒、失败分类退 75/1）。

| 仓库 | 计划页 | 要点提醒 |
|---|---|---|
| `ai-sdk` | `adapters/ai-sdk.md` | 三接入面一仓库；`aiSdkOtel()` 是矩阵唯一 remote-telemetry 证明 |
| `openai-compat` | `adapters/openai-compat.md` | 真实兼容网关；Chat Completions 不设负断言 Eval |
| `claude-agent-sdk` | `adapters/claude-agent-sdk.md` | MCP 连名带参 `{ input: { city: "Brooklyn" } }`；canUseTool 拒绝 → rejected |
| `codex-sdk` | `adapters/codex-sdk.md` | 断言从不出现 `input.requested`（无审批回调，不伪造） |
| `pi-agent-core` | `adapters/pi-agent-core.md` | hold()/take() 暂停恢复；客户端历史 |
| `langgraph` | `adapters/langgraph.md` | interrupt → Command(resume)；namespace → subagent 层级 |
| `claude-code` | `adapters/claude-code.md` | Docker；skills/MCP/plugins/settingsFile；原生 OTLP 内容脱敏是常态 |
| `codex-cli` | `adapters/codex-cli.md` | Docker；hook 信任 bypass 生效要有证据；实际模型从 session 侧写核对 |
| `bub` | `adapters/bub.md` | Python 运行时；tape 按位配对 → 只设串行工具场景 |
| `openclaw` | `adapters/openclaw.md` | 先用真实 CLI 固定六个事实点，fixture 没证明的不设 Eval |

Eval 预算纪律：一种协议行为一个 Eval，不做能力巡礼（`adapters/README.md`）。secrets 名进各自 `e2e.json.secrets` 与 `.env.example`，值找用户要，不签入。

## 5. CI（一个 agent，等 1–3 绿）

落点 `.github/workflows/e2e.yml`：从 `e2e.json` 生成 matrix（一 cell 一仓库，runner 规格按 `requires` 映射）；三层触发（PR 便宜档 / 路径门禁 sandbox / nightly 全量）；每 cell 上传 JUnit + `.niceeval/` + 日志，上传前按注入 secret 值扫描替换 `<redacted:VAR_NAME>`。

## 顺序与验证

顺序：0 → (1 ∥ 2) → 3 → 4（十仓库并行）→ 5。破坏性变更修复顺序按总则 §7.1（contract 先行 → `--group sdk` → `--group sandbox`）。

- 每仓库交付判据：注入真实 key 后 `pnpm e2e --repo <id>` 退 0；故意改坏一条断言能变红（验收不是恒真）。
- 根仓库：`pnpm run typecheck` + `pnpm test`（含新守护）。
- 收尾：踩坑与反直觉修法记 `memory/` 并索引；本 plan 各项完成后在文件顶部标注对应 commit。
- 注意：工作树里 `docs-site/zh/**`、`docs/concepts.md` 有并行 agent 的未提交改动，提交时不要夹带。
