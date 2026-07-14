# Coding Agent 扩展边界

Skills、MCP servers 和原生 Plugins 在 Agent setup 阶段安装。core 只保存安装 manifest，不理解每个 Agent 的配置目录、Marketplace 或包管理器。

## 类型边界

`SkillSpec` 只统一 Skill 来源：本地路径或带可选 ref/选择列表的仓库。安装位置和发现机制由 Adapter 决定。

MCP 使用共享 `McpServer` 形状，因为 Claude Code 与 Codex 都能表达 command、args 和 env；Bub 没有该构造字段。

Native Plugin 不统一：Claude Code 和 Codex 使用各自的 PluginSpec，Bub 使用 PythonPluginSpec。一个 Agent 不支持的扩展类型不出现在其 config 上。

TypeScript 是结构类型系统；两个供应商 Spec 恰好同形时，类型系统无法根据 marketplace source 的值判断是否传错。归属由字段所在的 factory 确定，实际来源是否合法由 Adapter setup 校验。

`marketplace.name` 不是调用方任意起的连接别名：真实 CLI 在 `marketplace add` 时按目标仓库自己 manifest 里的 `name` 注册，名字对不上时 add 静默成功、直到下一步 `plugin install <plugin>@<name>` 才失败。因此契约是 **`marketplace.name` 必须等于目标仓库 manifest 声明的 `name`**；Adapter setup 在 add 之后回读已注册的 marketplace 列表校验这个名字，对不上立刻抛出带两个名字的错误，不把失败拖延到 install 一步。

## 安装顺序

1. 准备 CLI 主配置和鉴权。
2. 安装 Skills。
3. 写 MCP 配置。
4. 安装供应商原生 Plugin / Python package。
5. 写安装 manifest。

每个 attempt 只执行一次。多轮 `send` 不重复安装。

## 可复现性

- Repo Skill 和 Marketplace 可以固定 ref。
- 多 Skill 仓库必须显式选择，除非仓库只有唯一 Skill。
- 同名 Skill 来自多个来源时按配置顺序安装，manifest 保留每个来源，不静默合并。
- 安装 checkpoint key 必须包含所有影响环境的配置，包括 Bub Python packages。

## 失败语义

路径不存在、仓库无法拉取、Skill 选择歧义、Plugin 不存在、MCP 配置无法写入或安装命令失败，都在 setup 阶段抛出并使 attempt errored。只有 Agent 已开始执行任务后的行为失败才进入 Turn status。

## Manifest

Adapter 通过共享 manifest writer 记录安装事实，runner 将其提升为 attempt artifact。Manifest 是审计结果，不参与能力分发，也不能替代实际行为事件；例如 Skill 是否被模型使用仍需 `skill.loaded` 或任务结果证据。
