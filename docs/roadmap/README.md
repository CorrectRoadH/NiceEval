# Roadmap

这里放仍有开放分歧、尚未定稿的候选设计。Roadmap 表示设计成熟度，不表示代码是否实现；正文讨论希望解决的问题、候选契约和待裁决分歧，不用“未实现”描述代码状态。

设计定稿后按目标形态重写并移入 [`../feature/`](../feature/)，不在原文追加“现已定稿”的时间线说明。

- [Multi-Agent](multi-agent/README.md) —— 多 agent eval 的三种场景
- [Adapters](adapters/README.md) —— LangGraph、OpenClaw 与其它候选接入
- [View 增强](view-enhancements.md) —— Compare 挑两次运行对比、Eval 目录页
- [图表组件的声明式子组件语法](report-chart-composition/README.md) —— 借鉴 recharts 子组件组合模型的候选契约,含逐组件语法对比举例
- [串行复用沙箱:清空 repo 而非重建](serial-sandbox-reuse.md) —— 一个热沙箱串行跑一批 eval,题间只 `git reset` 回温基线,展开跨 case 复用
