# Show —— 终端读结果

`niceeval show` 是结果的终端入口:不起 web server、不需要浏览器,直接把已经落盘的判定、断言、执行步骤、diff 打印到终端。它是 `niceeval exp` 跑完之后的默认下一步,也是 coding agent 自主闭环调试的入口——AI 反馈闭环的完整协议见 [docs-site 指南](../../../docs-site/zh/guides/agent-feedback-loop.mdx)。

裸跑 `niceeval show` 给出一份跨全部 experiment 的紧凑榜单,每条 eval 带一个 attempt locator(`@<id>`);`niceeval show @<locator>` 精确打开一个 attempt,再叠 `--eval` / `--execution` / `--diff` 看不同的证据切面。

Locator 必须带 `@` 前缀——它是从 `{experimentId, 快照 startedAt, evalId, attempt}` 确定性派生出的不透明短码,不是数组下标也不是文件路径。省略 `@` 或传一个不匹配任何已知 eval id / locator 的字符串会得到明确的 "No results matched" 报错,不做模糊猜测,见 [CLI](cli.md) 的真实示例。

## 相关阅读

- [CLI](cli.md) —— 命令形状、flag、真实终端输出示例。
- [Results](../results/architecture.md) —— show 读取的落盘格式(`result.json` / `events.json` / `trace.json` / `diff.json`)。
- [View](../view/README.md) —— 同一批数据的网页入口;证据室与 show 共用同一套 `AttemptLocator` 契约。
- [docs-site CLI 参考](../../../docs-site/zh/reference/cli.mdx) —— 全部命令与 flag 的用户手册。
