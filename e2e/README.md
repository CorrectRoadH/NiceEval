# e2e：真实模型全链路 CI 套件

设计见 [`docs/engineering/e2e-ci/README.md`](../docs/engineering/e2e-ci/README.md)。全程真实模型，没有任何 mock——费用靠每个仓库自己的 Experiment 档位（模型、runs、budget、timeout）控制。

## 布局

```text
e2e/
  repos/                       # 每个官方适配器一个仓库（group：sdk / sandbox）
  mechanism/                   # 只断言机制事实、不测协议路径的仓库（group：mechanism）
                                # 每个仓库都是完整项目（自己的 package.json、lockfile、
                                # niceeval.config.ts、agents/、evals/、experiments/、scripts/e2e.ts）
  scripts/
    discovery.ts               # 跨 repos/、mechanism/ 发现并校验每个仓库的 e2e.json
    list.ts                    # discovery.ts 的 CLI 包装
    run.ts                     # 构建候选包、选择仓库、隔离运行、汇总退出码
```

`repos/`、`mechanism/` 都是**collection 目录**：只表达物理归属，仓库的 `id` 在两者范围内全局唯一，`group` 由每个仓库自己的 `e2e.json` 声明，不从所在 collection 目录名反推。仓库之间互不 import，也不 import 这个根仓库的 `src/`——每个仓库自治，删除其它仓库或把本仓库复制到独立 checkout 都不改变它的行为。仓库形状、`e2e.json` 契约、独立性约束的完整定义见 [总则 §2](../docs/engineering/e2e-ci/README.md#2-独立测试仓库)。

## 跑起来

```sh
docker info                    # 沙箱类仓库需要本机 docker daemon 在跑

pnpm e2e                       # 全矩阵
pnpm e2e --repo claude-agent-sdk
pnpm e2e --group sdk           # 或 sandbox / mechanism
```

`pnpm e2e` 构建一次当前 checkout 的候选 niceeval 包，逐仓库隔离运行其唯一命令 `pnpm e2e`，核验注入的确实是候选包而非发布基线，退出码 `75` 重跑一次，最终汇总每个仓库的 pass / regression / infra 分类。单独调试某个仓库也可以直接进它自己的目录跑：

```sh
cd e2e/repos/claude-agent-sdk && pnpm install && pnpm e2e
```

## 当前仓库

| 仓库 | group | 说明 |
|---|---|---|
| `results` | mechanism | Results 落盘格式、`openResults()`、`--json`、`--junit` 契约 |
| `cli` | mechanism | CLI 选择、退出码折叠、缓存复用契约 |
| `ai-sdk` | sdk | AI SDK 三接入面：`uiMessageStreamAgent` / `aiSdkAgent` / `fromAiSdk` |
| `claude-agent-sdk` | sdk | `fromClaudeSdkMessages` |
| `codex-sdk` | sdk | `fromCodexThreadEvents` |
| `pi-agent-core` | sdk | `fromPiAgentEvents` |
| `langgraph` | sdk | `fromLangGraphEvents` |
| `claude-code` | sandbox | `claudeCodeAgent()`（Docker） |
| `codex-cli` | sandbox | `codexAgent()`（Docker） |
| `bub` | sandbox | `bubAgent()`（Docker + Python） |

覆盖表权威版本、每个仓库的评估计划见 [适配器域](../docs/engineering/e2e-ci/adapters/README.md)。`openclaw` 待补：需要真实 OpenClaw CLI 与凭据先固定协议事实，目前未建仓库。
