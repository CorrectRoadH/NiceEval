# niceeval Examples

`examples/zh/` 按**接没接 niceeval** 分两组：

- `zh/origin/` —— **还没接 niceeval 的普通应用**。每个都是独立可跑的项目，不 import niceeval，且都是真调用各自 SDK 的最小 MVP（有基本的前后端，前后端接口按各 SDK 自己的最佳实践实现，没有 mock 模式）。它们是接入的 before 基线：接入后的版本放到 `zh/eval/<同名目录>`，用 `pnpm run gen:diff-code` 统一对比"接入前后代码动了多少"。
- `zh/eval/<name>` —— **接入 niceeval 之后的完整评测项目**，定义了 evals / experiments，能 `niceeval exp` 跑起来（需要先 `npm install -D niceeval`；这里的示例以 link 方式指向仓库根）。

`zh/eval/<name>` 每个目录有独立的 `README.md`；`zh/origin/` 不再逐目录写 README，模型、HITL、跑法汇总在 [`zh/origin/README.md`](zh/origin/README.md) 的表格里，环境变量看各目录的 `.env.example`。

## 接入后（`zh/eval/` 等）

| 目录 | 用途 |
|---|---|
| [`zh/eval/ai-sdk-v7/`](zh/eval/ai-sdk-v7/) | **官方内建适配器 `aiSdkAgent`** 接入 AI SDK v7 应用：tool approval HITL、多模态、tracing，eval 与 UI 共用同一次模型调用。before 基线：[`zh/origin/ai-sdk-v7/`](zh/origin/ai-sdk-v7/)，代码 diff 见 [before/after 文档](../docs-site/zh/example/ai-sdk-v7-before-after.mdx) |
| [`zh/eval/langgraph/`](zh/eval/langgraph/) · [`zh/eval/claude-sdk/`](zh/eval/claude-sdk/) · [`zh/eval/codex-sdk/`](zh/eval/codex-sdk/) | 自己写 remote/deployed adapter 接入对应 origin 应用的早期快照 |
| [`zh/eval/custom-genai/`](zh/eval/custom-genai/) | 走 OTel 通道的完整评测项目；配对的 origin 应用已重写为 `zh/origin/pi-sdk`，这组 before/after 待重做（同 `langgraph` 那批） |
| [`zh/ai-sdk/`](zh/ai-sdk/) | **自己写 adapter**（`defineAgent` + `fromAiSdk`）接入 AI SDK v6 HTTP web agent，演示 remote adapter、事件流映射、双可观测 |
| [`zh/coding-agent-skill/`](zh/coding-agent-skill/) | 评测 Claude Code **Skill / Plugin** 对编码任务的实际提升（sandbox 工作区、文件断言） |

## 接入前（`zh/origin/`）

六个独立应用（ai-sdk-v7、langgraph、claude-sdk、codex-sdk、vm0、pi-sdk），各自真调用一个 agent framework/SDK，没有 mock 模式。模型、HITL 支持、跑法见 [`zh/origin/README.md`](zh/origin/README.md) 的表格，不在这里重复。

`openllmetry`、`openinference` 两个示例（OTel 自动埋点向，非 agent framework 向）暂时移除，等
`langgraph` 那批做完后再回来重做。

其中 `origin/langgraph` 同时是[连接可观测性指南](../docs-site/zh/guides/connect-otel.mdx)「2. 应用侧」LangSmith tab 的完整可跑版本（`origin/custom-genai` 已重写为 `origin/pi-sdk`，不再演示手写 OTel 埋点，「自己埋的 gen_ai」tab 暂时没有可跑参考实现）；`origin/claude-sdk`、`origin/codex-sdk`、`origin/vm0` 对应仓库根 README「Agent Frameworks」Roadmap 的条目（Roadmap 勾选追踪 adapter 实现进度，不是示例有无）。
