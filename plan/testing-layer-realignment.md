# PLAN：测试体系重划的代码侧迁移

契约已定稿：[测试体系总纲](../docs/engineering/testing/README.md)（分层与负面清单）、[功能域 · 报告与读面](../docs/engineering/testing/e2e/report.md)（读面 CLI 行为与渲染面验收）、[Reports 测试文档](../docs/engineering/testing/unit/reports.md)（只剩数据语义）。本计划是把存量测试代码对齐到新边界的执行清单，供实现 Agent 认领。

## 背景与依据

跟改率度量（方法见 [churn.md](../docs/engineering/testing/churn.md)，2026-07 窗口=六个月）的头部就是要迁移的对象：

```
 32/33  src/show/show.test.ts
 29/30  src/view/view-report.test.ts
 28/29  src/report/report.test.ts
 28/29  src/report/dual-render.test.tsx
 16/17  src/results/results.test.ts
 15/16  src/report/react/render.test.tsx
 14/15  src/view/data.test.ts
 12/13  src/results/host-equivalence.test.ts
 12/13  src/report/built-in-user-parity.test.tsx
```

（跟改次数/总变更次数；渲染与读面测试几乎每次 src 变更都被拖着改——正是新边界要消灭的税。）

## 任务 1：渲染类单元测试迁出

范围：`src/report/**`、`src/show/**`、`src/view/**` 下断言渲染产物（终端排版、DOM 结构、快照、双面逐字比对）的测试。

- 逐文件分拣：数据级断言（`*Data` 终值、装载规范化、错误对象）留下，改写测试名与断言使之只观察数据；渲染断言删除。
- 删除的渲染断言对应的行为，核对 [report.md §5 渲染面](../docs/engineering/testing/e2e/report.md) 已覆盖；有缺口先补该文档，再在 `e2e/report` 仓库的 `scripts/verify.ts` 落断言。
- 保留文件的 `// cases:` 头注对照 [Reports 测试文档](../docs/engineering/testing/unit/reports.md)的覆盖规范；指认不了任何覆盖类别的文件整体删除。

## 任务 2：CLI 进程行为单元测试迁出

范围：起 CLI 子进程或模拟完整命令行为的单元测试（show/view 的选择、`--history`、`--timing` 有界树、`--out` 导出、server 行为等）。

- 纯函数语义（选择算法、折叠规则、格式化）留在单元层。
- 进程级行为断言移入 `e2e/cli`（运行侧）与 `e2e/report`（读面）的 verify 脚本，对齐 [cli.md](../docs/engineering/testing/e2e/cli.md) 与 [report.md §4](../docs/engineering/testing/e2e/report.md) 的验收计划。

## 任务 3：e2e/report 仓库扩建

- 真实 Experiment 覆盖 passed / failed / errored 三态（现 deliberate-fail / deliberate-error eval 已在）。
- verify 链补齐 report.md §4（读面 CLI 行为）与 §5（渲染面）各 bullet；渲染断言用「自有事实 + 结构标记」写法，不锁完整输出。
- 签入代表性自定义报告文件（`extends: standard`、自定义多页、自定义组件、attempt page），每份走 `show --report` / `view --report` 的用户操作回归（真实浏览器：导航、折叠、过滤、locator 深链）。

## 任务 4：协议归一覆盖的后续

adapters 单元维度已取消（wire fixture 测试与登记表已删）。遗留事实，认领时知晓：

- `claude-agent-sdk`、`codex-sdk`、`pi-agent-core`、`langgraph` 的转换器在其官方工厂 + e2e 仓库落地前**没有协议验收覆盖**（[适配器域](../docs/engineering/testing/e2e/adapter/README.md)已声明为显式空白）。补覆盖的唯一路径是补官方工厂、建 `e2e/adapter/<id>` 仓库。
- `src/agents/`、`src/o11y/` 里被删测试对应的 fixture 数据文件若已无引用，一并清理。

## 验收

- `pnpm test` 全绿且总时长下降；`test/cases-registry.test.ts` 双向挂钩成立。
- 按 [churn.md](../docs/engineering/testing/churn.md) 重置窗口复测：show/view/report 测试不再占据跟改率头部。
- `pnpm e2e --repo report`、`--repo cli` 在注入真实 key 后各自全绿。
