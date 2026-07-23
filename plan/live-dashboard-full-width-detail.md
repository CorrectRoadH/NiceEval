# live 面板全宽 + ACTIVE 列重排:实现 TODO

契约已定稿,**一律以 docs 为准,本 plan 只列落点不复述契约**:

- live 面板全宽豁免与 ACTIVE 列分配:`docs/feature/experiments/cli.md`「框线体裁」「运行中的 live 面板」
- 区域框几何(100 上限的适用范围、行框同宽纪律、豁免形态):`docs/feature/reports/library/layout.md#区域框text-面的框线体裁`
- 测试覆盖类别:`docs/engineering/testing/unit/reports.md`「面板几何」(豁免上限形态)、`docs/engineering/testing/unit/experiments-runner.md`「live 面板的宽度与 ACTIVE 列分配」
- bug 台账:`memory/live-dashboard-active-row-width-clamp-mismatch.md`(现象/根因),裁决:`memory/live-dashboard-full-width-ruling.md`

## TODO

- [ ] **A. panel.ts 豁免上限形态**(单点)
  - [ ] A1. `src/report/model/panel.ts`:`renderPanel` 与 `panelContentWidth` 支持调用方声明豁免 100 列上限(参数形态实现自定,如 `capWidth?: boolean`;默认行为不变);几何测试补豁免形态用例(reports.md「面板几何」类别)
- [ ] **B. human.ts 接线与列算法**(依赖 A)
  - [ ] B1. `buildFrameLines()`:live 面板改传豁免上限 + `contentWidth` 一律经 `panelContentWidth` 取值(修 memory 台账里的手写 `width - 4` 漏钳制 bug);plan/summary/failures 等永久面板不豁免、行为不变
  - [ ] B2. `formatActiveRow` / `formatExperimentHookRow` 列算法重写:身份列(evalId、who)按**实际出现过的最长值**定宽,只放宽不回缩(跨帧单调,存在 renderer 闭包状态里;终端 resize 重算封顶),各封顶内容宽 40% / 20%,截尾补 `…`;elapsed 固定列;detail = 其余全部宽度;钩子行 label 跨身份两列,同一套算法
- [ ] **C. 单测**(依赖 B;只为已声明类别写测)
  - [ ] C1. 宽终端等价类:fake io `columns: 200`,断言 detail 文本完整出现在帧里、行宽与面板内容宽一致(`// bug: memory/live-dashboard-active-row-width-clamp-mismatch.md`)
  - [ ] C2. 列分配:短 id 不垫空格(detail 起始列贴着实际内容)、列宽跨帧单调不回缩、封顶比例、`…` 截断;永久面板仍 100 封顶
- [ ] **D. 验证**
  - [ ] D1. `pnpm run typecheck` → `pnpm test` 全绿
  - [ ] D2. 真机:宽终端(>150 列)跑 NiceEval-Eval 或 MemoryBench 一条 eval,肉眼确认 ACTIVE 行 detail 全程可见、无右缘截断错位;窄终端(80 列)回归确认体裁不变

## 验收

1. C1/C2 测试绿且可指认覆盖类别;reports.md 豁免形态用例绿。
2. 真机两种终端宽度下 ACTIVE 行 detail 可见、框线完整;`● eval id  experiment  elapsed  phase/detail` 列序与 docs 示例一致。
3. grep 核对 `docs/feature/experiments/cli.md` live 面板小节的每条声明与实现行为对得上。
