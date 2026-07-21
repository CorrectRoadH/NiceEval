# PLAN：全局并发位改为按瓶颈优先分配

> 主契约：`docs/runner.md`「调度:有界并发」与「派发顺序:瓶颈优先,追求最小总墙钟时间」，以及 `docs/feature/experiments/architecture.md`「实验级生命周期」的「不占并发位,也不折损优先级」条。本计划与主契约冲突时以主契约为准并同步修正本计划。
>
> 场景行已登记在 `docs/engineering/testing/unit/experiments-runner/cases.md` 的「并发」分区（3 行）。只为这些行写测试。
>
> 设计裁决与否决方案见 `memory/dispatch-priority-binds-to-slot-grant.md`。

## 这不是排序补丁，是换核心原语

现状 `src/runner/run.ts` 用 `Effect.makeSemaphore` 做全局闸（`globalSem`），获取语义是 FIFO，没有优先级钩子；「瓶颈优先」现在只体现为建 attempt 列表时的一次数组排序（run.ts:158-180）。这两者组合起来兑现不了契约：attempt 在请求并发位之前可能还有一段可变长的异步等待（实验级 `setup`，run.ts:767），数组排序给它的先机在这段等待里丢失，回来时队伍已被无 setup 的宽并发 run 排满。

所以不要试图把优先级"贴"到 `Effect.makeSemaphore` 上（它不暴露等待队列）。要引入一个自定义的**优先级名额分发器**替换 `globalSem`。

## TODO

### 1. 名额分发器（新原语）

新增一个内部模块（建议 `src/runner/slots.ts`），提供等价于 `withPermits(1)` 的获取/释放接口，但等待集按优先级出队：

- 排序键：`rounds` 降序 → run 发现顺序 → run 内 attempt 顺序。三者都在规划阶段已知，获取时作为参数传入即可，不在分发器内部重算。
- 释放一个名额时，发给当前等待集中排序最前者；初始 `maxConcurrency` 个名额视为同样多次「空出」。
- **中断安全**：等待中的 fiber 被中断（earlyExit / fail-fast / 用户 Ctrl+C）必须从等待集中移除且不泄漏名额——用 `Effect.acquireRelease` / `onInterrupt` 一类保证，别用裸 Promise 队列。
- **不破坏现有 finalizer**：`run.ts:775-786` 的 `Effect.ensuring` 实验级 teardown 计数在所有路径（含中断、含等待中被中止）必须照旧递减并触发 teardown。

`rounds` 的计算逻辑从 run.ts:172-175 抽出来复用，值仍只在建 attempt 列表时算一次。

### 2. 接线 run.ts

- `globalSem.withPermits(1)(body)`（run.ts:768）换成分发器获取，带上该 attempt 的排序键。
- run.ts:158-180 的数组排序**保留**：它仍决定同优先级下的稳定顺序，也让 dry-run / 计划输出的顺序与实际派发意图一致；但注释要改成「排序不再是优先级的作用点，优先级由分发器在分配时刻裁决」，别留下两处互相矛盾的解释。
- 实验级闸（`runSems`）**不动**：先来后到即可，同 run 内 attempt 优先级相同（契约已声明）。
- 等待 setup 期间不持有也不预留名额这一点不变（run.ts:764-767 的位置关系保持）。

### 3. 测试（只写已登记的三行）

在 experiments-runner 测试目录下，按 `cases.md`「并发」分区新增的三行各写一组，沿用现有 barrier fixture 风格（观察在飞状态，不用 `setTimeout` 猜调度）：

1. 瓶颈优先分配：带慢实验级 setup 的 `maxConcurrency: 1` 实验在 setup 结束后拿到下一个空出的名额，先于更早进入等待集的无上限 run；同轮次两 run 按发现顺序。
2. work-conserving：setup 进行期间其它 run 占满全部名额；等待 setup 的 attempt 计数保持 `queued`。
3. 等待中被中止不泄漏名额：abort 等待集中的 attempt 后，后续空位仍可全额分配给其余等待者。

测试处按 registry 规范加 `// bug: memory/dispatch-priority-binds-to-slot-grant.md`。先让这三条红，再改实现。

### 4. 验证

- `pnpm run typecheck`
- `pnpm test`（注意：`src/sandbox/e2b-reconcile.test.ts` 的 cases 声明缺失是本计划之外的既有红灯，别顺手改，也别把它当成本次引入）
- 真实 repo 冒烟：在 `/Users/ctrdh/Code/coding-agent-memory-evals` 跑一次混合配置（无上限 baseline + 带实验级 setup 的 `maxConcurrency: 1` 实验），确认后者的第一个 attempt 在 setup 结束后一个 attempt 耗时内起跑，而不是等到 baseline 主力跑完。
