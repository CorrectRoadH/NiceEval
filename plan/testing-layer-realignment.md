# PLAN：测试体系重划的代码侧迁移

契约已定稿：[测试体系总纲](../docs/engineering/testing/README.md)（分层职责与 Fake 边界）、[功能域 · 报告与读面](../docs/engineering/testing/e2e/report.md)（读面 CLI 行为与渲染面验收）、[功能域 · CLI](../docs/engineering/testing/e2e/cli.md)、[Reports 测试文档](../docs/engineering/testing/unit/reports.md)（只剩数据语义）。本计划把存量测试代码对齐到新边界，供实现 Agent 认领执行。

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

## 执行树

约定：**同缩进的兄弟节点可并行认领**（改动面互不重叠；多 agent 共享工作树时用路径限定提交，见 [memory/parallel-agents-shared-git-index](../memory/parallel-agents-shared-git-index.md)）；标 `依赖:` 的节点必须等依赖项完成后开始；每个叶子是一个可独立认领、独立提交的工作单元，验收写在叶子上。

**A 的统一分拣规则**（每个 A 叶子执行同一套）：逐文件过一遍测试断言——
数据级断言（`*Data` 终值、装载规范化、错误对象与文案、纯函数输出）**留下**，并核对能指认 [reports.md](../docs/engineering/testing/unit/reports.md) / 所属测试文档的覆盖类别；
渲染断言（`renderToStaticMarkup` DOM 结构、终端排版字符串、快照、双面逐字比对、进程级 CLI 行为模拟）**删除**——删除前核对该行为在 [report.md §4/§5](../docs/engineering/testing/e2e/report.md) 或 [cli.md](../docs/engineering/testing/e2e/cli.md) 有声明；没有声明的是设计缺口，先补该文档（单独 commit）再删；
整文件指认不了任何覆盖类别的，整文件删除。

```text
├── A 渲染与读面单元测试迁出                        A1–A5 互相并行
│   ├── A1 src/report/components/**
│   │      attempt-detail、entity-lists、metric-views、site-components、
│   │      summaries、render/dual-render/compute 按统一分拣规则处理
│   │      验收: 目录内每个测试文件要么删除、要么只剩数据断言;
│   │            pnpm test src/report 绿; 头注仍指 unit/reports.md
│   ├── A2 src/show/**（show.test.ts 是跟改率榜首 32/33、command.test.ts、report-host）
│   │      验收: 留下的只有装载/选择纯函数语义; pnpm test src/show 绿
│   ├── A3 src/view/**（view-report、data、site-parity、site-head、
│   │      artifact-serving、App、attempt-dialog、server 相关）
│   │      验收: server/导出的进程级行为断言全部移除(归 e2e/report §4);
│   │            pnpm test src/view 绿
│   ├── A4 宿主装载等价收窄（src/results/host-equivalence、dual-render 等价部分）
│   │      只保留 definition 同引用 + scope 深等两类断言(unit/reports.md「宿主装载等价」)
│   │      验收: 不再比较任何终端输出或 HTML
│   └── A5 src/runner/feedback/*.test.ts 与 runner/report.test.ts 的输出断言分拣
│          反馈事件与 reducer 状态(数据)留; 各 output profile 的具体行文本、
│          TTY 帧渲染断言删(归 e2e/cli 与 e2e/report 的真实进程输出验收)
│          验收: 留下的断言对象全部是事件/状态对象,无输出字符串匹配
│
├── B e2e/report 仓库扩建                           与 A、C 并行; B2–B5 依赖 B1
│   ├── B1 真实 Experiment 覆盖 passed/failed/errored 三态,
│   │      并产出一次 `view --out` 导出站作为后续断言的共享证据
│   │      验收: pnpm e2e --repo report 现有验收链绿, .niceeval 含三态 attempt
│   ├── B2 读面 CLI 行为验收（report.md §4 五个 bullet 逐条落 verify）   依赖: B1
│   │      验收: §4 每个 bullet 在 verify 脚本里有对应断言,可逐条指认
│   ├── B3 渲染面·结构与终端排版（report.md §5 结构/排版/双面三个 bullet） 依赖: B1
│   │      验收: 对 show 输出与导出 HTML 的断言全部是「自有事实 + 结构标记」,
│   │            不锁颜色/像素/完整 class 列表
│   ├── B4 渲染面·浏览器视觉与交互（§5 视觉 bullet,真实浏览器）           依赖: B1
│   │      验收: 禁 JS 可读、染色与 <details> 交互逐项操作可达
│   └── B5 自定义报告用户操作回归（§5 自定义报告 bullet）                依赖: B1
│          签入代表性 --report 文件(extends 外壳/多页/自定义组件/attempt page),
│          每份走 show --report 与 view --report 的同一条读面+渲染验收
│          验收: 导航、--page 索引、折叠、过滤、locator 深链逐项可达
│   （B 整体验收: pnpm e2e --repo report 全绿; verify 断言与 report.md §4/§5
│     逐 bullet 一一对应,无空头声明）
│
├── C e2e/cli 仓库核对                              与 A、B 并行
│      cli.md 验收计划(选择/退出码折叠/缓存)逐条核对现有 verify 是否落实,缺的补上
│      验收: pnpm e2e --repo cli 全绿; cli.md 每条计划可指认到 verify 断言
│
├── D 死代码清理                                    依赖: A(需要知道哪些引用已消失)
│      src/agents、src/o11y 已删测试遗留的孤儿 fixture 文件;
│      src/report、src/view 测试 harness 中只服务渲染断言的构造器
│      验收: pnpm run typecheck 绿; git grep 无悬空 import;
│            pnpm test 收集文件数与套件时长较基线下降
│
└── E 收官验收                                      依赖: A、B、C、D 全部完成
       1. pnpm test 全绿,总时长低于基线(2026-07-21 基线: ~11s / 986 例 / 73 文件)
       2. test/cases-registry.test.ts 双向挂钩自动成立(随 pnpm test)
       3. 注入真实 key: pnpm e2e --repo report 与 --repo cli 全绿
       4. churn 复测: 按 churn.md 把窗口起点设为本计划完成之后,
          跑一段时间后 show/view/report 测试不再占据跟改率头部
```

## 不在本计划内

- `e2e/undo/` 四个无官方工厂 SDK（claude-agent-sdk、codex-sdk、pi-agent-core、langgraph）的协议覆盖：唯一路径是补官方工厂、建 `e2e/adapter/<id>` 仓库（[适配器域](../docs/engineering/testing/e2e/adapter/README.md)已声明为显式空白），是产品工作不是测试迁移。
- E2E 适配器仓库（ai-sdk / claude-code / codex-cli / bub）的评估计划本身没有变化，不需要动。
