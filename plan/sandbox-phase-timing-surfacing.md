# PLAN：阶段计时补收尾段与钩子步级明细，并在 `show` / `view` 展示

> 面向执行者：把本文件直接交给实现 AI。按阶段顺序执行；每个阶段先满足自己的验收条件，再进入下一阶段。
>
> 来源：2026-07-14 用户对 sandbox eval 可调试性的契约挑战——沙箱启动时间、setup 链上每个钩子的时间、各生命周期（含收尾）的执行与用时都要有落盘数据，并在 `show` 和 `view` 里可读。设计裁决出处：`memory/phase-timings-teardown-steps-and-show-view.md`。
>
> 范围（2026-07-14 扩充，见 memory 的 lifecycle-phase-vocabulary-unification 与 scoped-feedback-finalized 两条裁决）：`phases` 契约的收尾段 + `steps` 扩展、show / view 展示面，以及**生命周期词表三套合一**——代码里的 `AttemptPhase` 内部枚举、`LifecycleOperationName` 类型、live 展示 id、agent/ci envelope 的 `phase=` 全部换成 `LifecyclePhase` 统一名（`sandbox-provision`→`sandbox.create`、`running`/`test`→`eval.run`、`agent.tracing`→`telemetry.configure`、`baseline`→`workspace.baseline`、`score`→`scoring.evaluate`、`trace`→`telemetry.collect`，新增 `eval.teardown`）；`AttemptError.operation` / `DiagnosticRecord.operation` 改名 `phase`，`RESULTS_SCHEMA_VERSION` 6→7。不要实现 `agent.setup` 内部的安装明细（adapter 的进度走已定稿的 `ctx.progress/diagnostic`，计时不细分），不要动 `bench/` 判据逻辑、Traces 瀑布或报告组件。

## 开始前必读

1. `CLAUDE.md`：仓库总规则，特别是「先文档后代码」、同步义务表、禁止 feature branch。
2. `docs/engineering/benchmark/README.md`：`phases` 契约的权威语义（主链 / 收尾两段、failed 规则、`steps` 规则、口径、vitest 守护清单）。
3. `docs/feature/results/architecture.md`：`PhaseName` / `PhaseTiming` / `StepTiming` 类型契约。
4. `docs/feature/reports/show.md`：首页 `timing:` 行与 `--timing` 切面的预期输出（示例即验收样式）。
5. `docs/feature/reports/view.md`：Attempt 详情阶段耗时区的契约。
6. `docs-site/zh/guides/viewing-results.mdx`：用户可观察行为的公开口径。
7. memory：`attempt-phase-tracking-teardown-always-last`（teardown 在 finally 里无条件触发的坑）、`attempt-phase-scoped-feedback-api-deferred`（不要越界实现的范围）。
8. 当前实现入口：`src/runner/attempt.ts`（阶段收集与 teardown 顺序）、`src/show/`（首页与证据切面渲染）、`src/cli.ts`（`FLAG_OPTIONS`）、`src/view/`（Attempt 详情）、`test/fixtures/sandbox-hooks`（计时守护复用的流水线）。

## 阶段 1：词表合一 + runner 落盘收尾段与 steps

- 先做全局换名：`LifecyclePhase` 闭集落 `src/types.ts`，删除 `LifecycleOperationName` 与旧 `AttemptPhase` 字符串；live 表格、feedback coordinator、i18n 展示文案、`error.phase` / `diagnostics[].phase` 一次换齐，不留别名层；`RESULTS_SCHEMA_VERSION` 升 7。grep `sandbox-provision`、`"running"`、`agent.tracing`、`operation:` 确认清零。
- `attempt.ts` 在 eval cleanup / agent teardown / sandbox teardown 钩子链 / sandbox stop 各自边界计时，追加 `eval.teardown` / `agent.teardown` / `sandbox.teardown` / `sandbox.stop` 条目；收尾条目在结果封口前写入（封口本就在 stop 之后，见 Results 契约）。
- 收尾条目的 `failed` 独立标记，不影响 verdict；主链 `failed` 语义不变；`agent.run` 只出现在 `error.phase` / `diagnostics[].phase`，不进 `phases` 数组。
- `sandbox.setup` / `sandbox.teardown` 逐钩子计时进 `steps`：具名函数用 `fn.name`，匿名用 `setup#<i>` / `teardown#<i>`（i 为链上 1 起序号）；`eval.run` 逐 send 计时进 `steps`（`send#<i>`）。
- 验收：`docs/engineering/benchmark/README.md`「框架自测」第 1–6 条全部落成 vitest 断言（复用 `test/fixtures/sandbox-hooks`，不新增 fixture 家族）；`pnpm run typecheck`、`pnpm test` 通过。

## 阶段 2：`show` 展示面

- attempt 首页新增 `timing:` 行（主链分解 + `teardown +N` 尾项；无 `phases` 时输出 `phase timing unavailable`），errored 首页在 error 块后给同款单行（含 `✗ failed here`）。
- 新增 `--timing` 证据切面，输出样式以 `docs/feature/reports/show.md` 的两个示例为准（逐阶段、steps 树形缩进、收尾分组、失败标记、`total`）。
- `--timing` 进 `src/cli.ts` `FLAG_OPTIONS` 并写 JSDoc（缺注释生成器报错）；跑 `pnpm docs:reference` 重新生成参考页区块；核对 `src/i18n/` 两份 `--help` 速查是否需要点名（手工体裁，按现有取舍）。
- `available` 列表在有 `phases` 时列出 `--timing`。
- 验收：`pnpm run niceeval -- show --help` 冒烟；对真实 sandbox eval 结果跑 `show @<locator>` 与 `show @<locator> --timing`，输出结构与 docs 示例一致；`pnpm test` 通过（含 reference 漂移守护）。

## 阶段 3：`view` 展示面

- Attempt 详情新增阶段耗时区：主链分解条 + 收尾段列表，`sandbox.setup` / `sandbox.teardown` 行可展开 steps，失败阶段带标记；数据只来自 `result.json` 的 `phases`，无 `phases` 时该区显示不可用而非隐藏错误。
- 不把 runner 阶段混入 Traces 瀑布（Observability 契约不变）。
- 记得 `pnpm run view:build`（见 memory `codeview-perline-hidden-scrollbar-clips-text` 的教训）。
- 验收：本地 `niceeval view` 打开真实结果核对；`--out` 静态导出后阶段区照常显示。

## 统一验收

```bash
pnpm run typecheck
pnpm test
pnpm run niceeval -- show --help
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```

并在真实 eval 仓库（如 `/Users/ctrdh/Code/coding-agent-memory-evals`）里 `pnpm exec niceeval` 跑一条 sandbox eval，核对 `result.json` 的 `phases`（含收尾段与 steps）与 `show --timing` 输出和 docs 预期一致。
