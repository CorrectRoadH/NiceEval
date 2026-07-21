# e2e：真实模型全链路 CI 套件

设计见 [`docs/engineering/e2e-ci/README.md`](../docs/engineering/e2e-ci/README.md)。全程真实模型，没有任何 mock——费用靠每个仓库自己的 Experiment 档位（模型、runs、budget、timeout）控制。

## 布局

```text
e2e/
  repos/                       # 每个官方适配器一个仓库（group：sdk / sandbox）
  mechanism/                   # 只断言机制事实、不测协议路径的仓库（group：mechanism）
                                # 每个仓库都是完整项目（自己的 package.json、lockfile、
                                # niceeval.config.ts、evals/、experiments/、scripts/e2e.ts）
  undo/                        # 缺少完整官方 Agent 工厂的停用 fixture；不参与发现与 CI
  scripts/
    discovery.ts               # 跨 repos/、mechanism/ 发现并校验每个仓库的 e2e.json
    injection.ts               # 构建候选 tarball、算指纹、装后核验解析到的确实是候选包
    secrets.ts                 # 按 e2e.json.secrets 构造每个仓库最小注入的子进程环境
    list.ts                    # discovery.ts 的 CLI 包装
    run.ts                     # 构建候选包、选择仓库、隔离运行、汇总退出码
```

`repos/`、`mechanism/` 是编排器扫描的两个 **collection 目录**；`undo/` 不是 collection。启用仓库的 Experiment 直接实例化 `niceeval/adapter` 官方工厂，不保留 `agents/` 或本地 Adapter 实现。仓库形状、`e2e.json` 契约、独立性约束的完整定义见 [总则 §2](../docs/engineering/e2e-ci/README.md#2-独立测试仓库)。

## 跑起来

```sh
docker info                    # 沙箱类仓库需要本机 docker daemon 在跑

pnpm e2e                       # 全矩阵
pnpm e2e --repo ai-sdk
pnpm e2e --group sdk           # 或 sandbox / mechanism
```

`pnpm e2e` 构建一次当前 checkout 的候选 niceeval 包，逐仓库隔离运行其唯一命令 `pnpm e2e`，核验注入的确实是候选包而非发布基线，退出码 `75` 重跑一次，最终汇总每个仓库的 pass / regression / infra 分类。单独调试某个仓库也可以直接进它自己的目录跑：

```sh
cd e2e/repos/ai-sdk && pnpm install && pnpm e2e
```

## 当前仓库

| 仓库 | group | 说明 |
|---|---|---|
| `results` | mechanism | Results 落盘格式、`openResults()`、`--json`、`--junit` 契约 |
| `cli` | mechanism | CLI 选择、退出码折叠、缓存复用契约 |
| `ai-sdk` | sdk | `uiMessageStreamAgent` |
| `claude-code` | sandbox | `claudeCodeAgent()`（Docker） |
| `codex-cli` | sandbox | `codexAgent()`（Docker） |
| `bub` | sandbox | `bubAgent()`（Docker + Python） |

覆盖表权威版本、每个仓库的评估计划见 [适配器域](../docs/engineering/e2e-ci/adapters/README.md)。`claude-agent-sdk`、`codex-sdk`、`pi-agent-core`、`langgraph` 在完整官方工厂落地前暂存于 `undo/`；`openclaw` 待真实 fixture 固定后再建仓库。
