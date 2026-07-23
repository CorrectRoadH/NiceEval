# exp 输出收敛为「人读文本 + `--json`」:实现 TODO

契约已定稿,**一律以 docs 为准,本 plan 只列落点不复述契约**:

- 两形态原则、逐信息规则表、流边界:`docs/feature/experiments/cli.md`(开头「每条命令一个人读 text 面,`--json` 是机器面」与「什么动态更新,什么逐条追加」)
- NDJSON 事件词表、`start`/`result` 事件形状、`--dry --json` 单文档:`docs/feature/experiments/cli.md#机器怎么读--json`
- 用例:`docs/feature/experiments/use-case/json-agent-loop.md`、`json-ci-gate.md`
- kept sandbox 的 `kept` 事件:`docs/feature/sandbox/cli.md`
- 失败摘要在 `failure` 事件的结构化字段:`docs/feature/scoring/library/display.md`
- 测试覆盖类别:`docs/engineering/testing/unit/experiments-runner.md`「形态解析与 `--json` 流不变量」;E2E 验收 `docs/engineering/testing/e2e/cli.md`、事件 grep 模式 `docs/engineering/testing/e2e/verification.md`
- 裁决与否决方案:`memory/exp-output-two-forms-ruling.md`

## TODO

- [ ] **A. 形态解析**(单点)
  - [ ] A1. `src/cli.ts` + `src/runner/feedback/profile.ts`:`--output` flag 删除,`resolveOutputForm` 收敛为 `--json` 布尔 + TTY 版式判断,删 CI 环境变量嗅探;`FLAG_OPTIONS` 增 `--json` 布尔项(JSDoc 为参考页文案单源)、删 `--output` 与 `--json <path>`、`--quiet` 确认不存在
  - [ ] A2. 传 `--output …` 按用法错误退出,`fix:` 给「人读文本直接运行;机器面用 --json」——beta 不留别名
  - [ ] A3. exp 的 JSON 聚合文件出口移除(`Json(path)` 保留为库 reporter);`--junit` 不动
- [ ] **B. renderer 合并**(依赖 A)
  - [ ] B1. `src/runner/feedback/{agent,ci}.ts` 合并为 `json.ts`:NDJSON 单 stdout 流、首行 `start` 带 `format`/`schemaVersion`、字段名复用 Results 词表、失败无 suppression、心跳 30s、`result` 收尾(completion/快照/junit 路径);`computeCiExitCode` 更名 `computeExitCode`
  - [ ] B2. 非 TTY human 追加流成为无 flag 默认;流路由按补充裁决改为单一 stdout(stderr 只留启动期错误,新行为,补实现与断言);人读失败展开上限 10
  - [ ] B3. kept / experiment_setup / eval 等事件按词表逐个接线;`--dry --json` 单文档
- [ ] **C. 单测 + E2E**(依赖 B;只为已声明类别写测)
- [ ] **D. 同步义务**
  - [ ] D1. `pnpm docs:reference` 再生 `docs-site/zh/reference/cli.mdx` GENERATED 区块;核对 `src/i18n/` 两份 `--help` 速查
  - [ ] D2. `pnpm run typecheck` → `pnpm test`;真机 `pnpm run niceeval -- exp <某实验> --dry --json` 冒烟
  - [ ] D3. e2e 消费仓(NiceEval-Eval / MemoryBench)脚本里 `--output ci|agent` 与 `--json <path>` 用法迁移

## 验收

1. `niceeval exp … --json | while read line; do echo $line | jq -e .event; done` 全部可解析;`--output` 任何取值报用法错误。
2. `CI=true` 非 TTY 下不加 flag 得到人读追加日志(与 TTY 文案一致、零 ANSI);加 `--json` 得到事件流。
3. grep 全仓无 `NICEEVAL ` 前缀与 `niceeval: ` 前缀的输出路径残留。
