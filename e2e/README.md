# e2e：真实模型全链路 CI 套件

设计见 [`docs/e2e-ci.md`](../docs/e2e-ci.md)。全程真实模型,没有任何 mock——费用靠便宜模型档位、小 `runs`、per-experiment `budget` 控制。

- `shared/`：唯一一份 eval / experiment 定义,全部是参数化 factory。断言逻辑改这里、全矩阵生效。
- `apps/`：被测应用,从 `examples/zh/tier1/<name>` 拷来(去掉 eval 侧文件),真实调用原样保留。凭据在各自 `.env`(不进 git)。
- `projects/`：每个 SDK 一个薄 niceeval 项目——adapter(拷自 tier1)+ `profile.ts`(协议现实声明)+ 3 行 stub。SDK 间差异只允许出现在 profile 里。
- `scripts/verify.mjs`：e2e 的"真正的测试"。把 CLI 当黑盒子进程跑,对照期望表校验退出码 + `summary.json`(含"期望 exit 1"的 verdicts 实验)。

## 跑起来

```sh
# 一次性:装依赖
pnpm install --dir e2e
for d in e2e/apps/{ai-sdk-v7,claude-sdk,codex-sdk,pi-sdk}; do pnpm install --dir $d; done
python3 -m venv e2e/apps/langgraph/.venv && e2e/apps/langgraph/.venv/bin/pip install -r e2e/apps/langgraph/requirements.txt

# 起被测应用(每个一个终端,或 CI 里 nohup;eval 不代管进程)
(cd e2e/apps/ai-sdk-v7 && pnpm start)     # :34001
(cd e2e/apps/claude-sdk && pnpm start)    # :32001
(cd e2e/apps/codex-sdk && pnpm start)     # :31001
(cd e2e/apps/pi-sdk && pnpm start)        # :33001
(cd e2e/apps/langgraph && .venv/bin/python src/backend/server.py)  # :35000

# 全矩阵对账(或单项目:node e2e/scripts/verify.mjs ai-sdk-v7)
node e2e/scripts/verify.mjs
```
