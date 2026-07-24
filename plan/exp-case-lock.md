# 用例锁(并发 Invocation 不双跑):实现 TODO

契约已定稿,一律以 docs 为准,本 plan 只列落点:

- 锁的完整契约(粒度/锁文件/心跳/等待+携带/接管/释放/非目标):`docs/feature/experiments/architecture.md#并发-invocation用例锁`
- 显示与事件(`elsewhere` 计数、运行级行、`lock_wait` 事件、`ExpPlanRow.locked`):`docs/feature/experiments/cli.md`(「等待并发 run 的显示」与 TypeScript 形状)
- 携带续接在缓存链路的位置:`docs/runner.md#缓存指纹去重`
- 裁决与粒度出处:`memory/case-lock-wait-not-skip-ruling.md`
- 覆盖类别声明:`docs/engineering/testing/unit/experiments-runner.md`「用例锁与并发 Invocation」

## TODO

- [ ] **A. 锁原语**(新模块 `src/runner/lock.ts`):文件名 slug + 身份哈希(平铺 `.niceeval/locks/`)、O_EXCL 原子创建、心跳续租(10s,tmp+rename 重写 `heartbeatAt`)、过期判据(落后 30s)、过期锁 rename 接管(rename 赢家获得执行权)、删除释放;锁文件形状 `{ experimentId, evalId, pid, host, startedAt, heartbeatAt }`
- [ ] **B. 调度接线**(`src/runner/run.ts` + `planCarry`):携带规划之后逐用例取锁;全携带用例不取锁;撞新鲜锁进等待集——不占全局并发位、不触发实验级 setup、每心跳周期重读锁文件;锁释放/接管后对该用例重查携带(复用 planCarry 的逐 attempt 判定),携入补齐、缺失序号取锁补跑;`--force` / `--reuse-sandbox` 等待照旧、等完自跑;`--dry` 只读锁目录出 `locked` 标注
- [ ] **C. 释放路径**:用例全部 attempt 收尾后删锁;中断/强清路径挂进既有的宿主机侧兜底排空(与 teardown 注册表同一条退出链);接管时记 `lock-taken-over` warning 级 diagnostic(按 dedupeKey 折叠)
- [ ] **D. 反馈**:`elsewhere` 计数状态(与 queued 互斥,五项恒等式;非零才进 human 首行)、每实验一行运行级 `waiting on another run` 行(TTY)/按实验聚合起止行(非 TTY)、`--json` 逐用例 `lock_wait` started/resolved 事件、`ProgressEvent.elsewhere` 字段、`ExpPlanRow.locked`
- [ ] **E. 测试**:只为 experiments-runner.md「用例锁与并发 Invocation」已声明类别写测;锁文件走隔离 `niceevalRoot`,心跳/等待用 `TestClock`
- [ ] **F. 同步义务**:`pnpm run typecheck` + `pnpm test`;公开面变更(新事件成员、`ProgressEvent` 形状)核对 `pnpm docs:reference` 是否涉及;真实 eval 仓(`/Users/ctrdh/Code/MemoryBench`)双终端并行冒烟:交集用例一边 `elsewhere` 等待、对方跑完后携入;`kill -9` 持有侧验证 30s 后接管

## 验收

1. 两个终端跑选择有交集的 exp:交集用例只真实派发一次;等待侧 live 面板出现 `elsewhere` 计数与 `waiting on another run` 行,最终结果集完整(`reused` 含等后携入)。
2. `kill -9` 其中一边:另一边 30s 内接管其锁并照常跑完,附带一条 `lock-taken-over` warning;整批结束后 `.niceeval/locks/` 为空。
3. 对方运行期间 `--dry` 显示 `locked` 标注且不取锁、不等待。
