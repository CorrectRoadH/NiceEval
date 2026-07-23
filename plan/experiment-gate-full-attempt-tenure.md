# 实验级并发闸全程持有:实现 TODO

契约已定稿,**一律以 docs 为准,本 plan 只列落点不复述契约**:

- 两级闸持有期语义单点:`docs/runner.md#调度有界并发`
- 实验闸保证与用例:`docs/feature/experiments/README.md`(maxConcurrency 段)、`docs/feature/experiments/use-case/concurrency.md`(用例 2/3/4/5)
- 退避释放全局位、实验闸不释放:`docs/feature/error-classification/architecture.md#退避与槽位`
- 测试覆盖类别:`docs/engineering/testing/unit/experiments-runner.md`「并发」(退避的槽位持有期差 + 实验级闸覆盖沙箱收尾,两条新等价类)
- bug 台账:`memory/turn-retry-backoff-releases-experiment-serial-lock.md`(现象/根因/回归校验),裁决:`memory/experiment-gate-tenure-ruling.md`

## TODO

- [ ] **A. 机制修正**(单点改动)
  - [ ] A1. `src/runner/run.ts` turn 级 `ConcurrencySlot`(约 L752-761):`release`/`reacquire` 只操作 globalSem,不再动 runSem;重写该处及 L746-750 的注释(退避让出的是全局位,实验闸全程持有,与 docs 契约同句)
  - [ ] A2. 顺手核对 L320-335 两级闸注释与新契约一致;`src/sandbox/retry.ts` 的 `ProvisionSlot` 只涉 sandboxSem,**不要改**
- [ ] **B. 公开面文案**(依赖 A 定稿,可与 C 并行)
  - [ ] B1. `src/runner/types.ts` `ExperimentDef.maxConcurrency` TSDoc(约 L488-494):补「名额与 attempt 同生命周期(沙箱创建到销毁,退避不释放)」一句——参考页文案单源在此
  - [ ] B2. `pnpm docs:reference` 再生成参考页区块;`pnpm test` 漂移守护须绿
- [ ] **C. 单测**(依赖 A;类别已声明,只为已声明类别写测)
  - [ ] C1. 「退避的槽位持有期差」:fake adapter 首次 send 抛可重试错 → `TestClock` 停在退避窗口内 → 断言同实验(`maxConcurrency: 1`)第二个 attempt 未启动;推进时钟退避结束、首 attempt 跑完后第二个正常放行。测试加 `// bug: memory/turn-retry-backoff-releases-experiment-serial-lock.md`
  - [ ] C2. 「实验级闸覆盖沙箱收尾」:fake sandbox 的 teardown 钩子内设 barrier 挂起 → 断言第二个 attempt 的沙箱未创建;放行 barrier 后第二个 attempt 开跑
  - [ ] C3. 全局位在退避期间确实让出:全局并发 2、两个无关实验,一个进退避时另一个能拿到位(护住不被 A1 顺手改坏)
- [ ] **D. 验证与收尾**(依赖全部)
  - [ ] D1. `pnpm run typecheck` → `pnpm test` 全绿
  - [ ] D2. 真机回归(下游 `/Users/ctrdh/Code/coding-agent-memory-evals` mempal 实验):running 恒 ≤1、各 attempt 记忆回存 savedAt 无重叠、记忆 KB 单调不回退;不满足则回 A,不改契约
  - [ ] D3. memory 台账条目标「已修」并补落点 commit

## 验收

1. C1-C3 三条测试绿且各自可指认覆盖类别;无越界新增测试。
2. `pnpm run typecheck`、`pnpm test` 全绿(不出现新失败)。
3. D2 的三条真机判据全部满足。
4. grep 核对:`docs/` 与 `docs-site/zh` 中「退避让位」相关表述与实现行为一致(runner.mdx「实验自己的 maxConcurrency 名额不让」)。
