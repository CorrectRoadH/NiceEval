# PLAN：报错必带下一步——错误与警告反馈契约落地

> 面向执行者：把本文件直接交给实现 AI。按阶段顺序执行；每个阶段先满足自己的验收条件，再进入下一阶段。
>
> 来源：2026-07-15 用户对 `stale-snapshot` 警告可操作性的挑战——警告只报时距不给动作，用户裁决「所有报错都应带上解决方案」。设计裁决出处：`memory/error-feedback-message-carries-fix.md`。
>
> 范围：`docs/error-feedback.md` 定义的操作性反馈全部五个面——CLI 启动期错误、运行期 diagnostics、Selection 警告、读取分类提示、库抛出错误类。被测对象的失败事实（断言差异、`AttemptError`、verdict）**不在范围内**，不要给它们加 fix 字段或改消息形状。

## 开始前必读

1. `CLAUDE.md`：仓库总规则，特别是「先文档后代码」、同步义务表、禁止 feature branch。
2. `docs/error-feedback.md`：本次落地的权威契约——三段式、`command` 字段、CLI 两行形状、适用边界。
3. `docs/feature/results/library.md`「警告 kind 全集」：每个 kind 的下一步与 `command` 已逐行定稿，照表实现。
4. `docs/feature/results/architecture.md`：`DiagnosticRecord` 新形状（`command?: string`）；新增可选字段按该页版本规则**不递增** `schemaVersion`。
5. `docs/engineering/unit-tests/registry.md` 与三份登记表的新增行：`results/cases.md`（Selection 分区「警告必带下一步」行）、`experiments-runner/cases.md`（「CLI 启动期错误格式」分区）、`reports/cases.md`（「show/view 宿主等价与选择」分区宿主渲染行）。测试只为这些已登记行而写。
6. memory：`error-feedback-message-carries-fix`（为什么不是独立必填 fix 字段——不要在实现里"顺手"加回去）。
7. 当前实现入口：`src/results/`（Selection 警告构造，`select.ts` 一带）、`src/types.ts`（`SelectionWarning` / `DiagnosticRecord`）、`src/cli.ts` 与 `src/tty-line.ts`（bootstrap 错误出口）、`src/runner/feedback/`（运行期诊断渲染）、`src/show/` 与 `src/view/`（宿主警告显示）、`src/report/`（web 警告条）。

## 阶段 1：结构化类型与 Selection 警告

- `SelectionWarning` 与 `DiagnosticRecord` 加 `command?: string`，TSDoc 按 docs 的字段注释写（缺注释生成器报错）；跑 `pnpm docs:reference` 重新生成参考页区块。
- 按「警告 kind 全集」表逐 kind 落实：`partial-coverage` / `stale-snapshot` / `unfinished-snapshot` 的 message 以下一步收尾并带 `command = niceeval exp <experimentId>`（真实 id 替换，不是模板字面量）；`stale-snapshot` 的 message 同时含忽略条件（"if nothing changed between runs, the numbers remain comparable" 语义，措辞可调但条件必须在）；`missing-startedAt` 给定位动作、不带 `command`。
- `selection.filter()` 修剪警告时 `command` 随条目走，不需要额外处理，但补断言确认。
- 验收：results/cases.md「警告必带下一步」行的正例/反例全部变绿；`pnpm run typecheck`、`pnpm test` 通过（含 reference 漂移守护）。

## 阶段 2：CLI 启动期错误与库错误类

- coordinator 激活前的所有错误出口（argv 解析、config 加载、eval 发现、show/view 输入解析、`view --out` 防呆）收敛到一个渲染函数：`error:` 现象行 + 缩进两格 `fix:` 下一步行，纯 ASCII；三种 output profile 与 bootstrap stderr 出口同形。
- 盘点这条路径上每个现存错误文案，逐条补齐下一步（能给命令给命令：`niceeval --help`、`niceeval list`、指向 experiments 文件等；不能给命令给定位动作）。盘点方式：grep 启动期的 throw / stderr 写点，列清单后逐条过，不静默漏项。
- 库错误类（`MalformedLocatorError`、`LocatorNotFoundError`、`copySnapshots` 预检失败等）的 `message` 补齐下一步；CLI 捕获后 `fix:` 行原样取错误对象的下一步，不在 CLI 层另写文案。
- 验收：experiments-runner/cases.md「CLI 启动期错误格式」两行全部变绿；`pnpm run niceeval -- exp --model x`、未知 flag、`show @不合法串` 冒烟，输出与 `docs/error-feedback.md` 的两行形状一致。

## 阶段 3：运行期 diagnostics 与宿主渲染

- 盘点 `src/runner/feedback/` 经手的诊断文案（sandbox provisioning 重试耗尽、reporter-error、teardown 失败、budget 不可执行等），message 逐条补下一步；有单命令形态的补 `command`。
- `show`（text 面）原样打印警告与诊断的 message，不截断尾段；`view`（web 面）把 `SelectionWarning.command` / `DiagnosticRecord.command` 渲染为可复制命令，无 `command` 不硬造动作。
- 验收：reports/cases.md 宿主渲染行变绿；在真实 eval repo（如 `/Users/ctrdh/Code/coding-agent-memory-evals`）分次重跑构造 stale-snapshot，`niceeval view` 的警告条出现可复制的 `niceeval exp <id>`，`niceeval show` 的警告文本以命令与忽略条件收尾。

## 收尾同步义务

- 公开面变了：`pnpm docs:reference` 已在阶段 1 跑过，最后再核对一次无漂移；`src/i18n/` 两份 `--help` 速查不涉及新 flag，无需动。
- `docs-site/zh/guides/debugging.mdx` 已在设计批次声明「报错末尾就是下一步」；实现后按真实输出核对该段示例语气无夸大即可，英文入口由翻译流程同步。
- 全部完成后 `pnpm run typecheck` + `pnpm test`；commit message 说清行为变化（报错/警告消息形状属可观察行为）。
