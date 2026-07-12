# Show —— CLI

## 命令形状

```sh
niceeval show                         # 终端榜单:每个 experiment 的现刻判定,跨 run 合成
niceeval show weather/brooklyn        # 单个 eval:attempt、断言明细,每行带 @<locator>
niceeval show @<locator>              # 精确一个 attempt:无 flag → 紧凑全景;--eval/--execution/--diff 看对应证据切面
niceeval show weather/brooklyn --history   # 跨 run 时间轴(只列真实执行;与 --report 互斥)
niceeval show --report reports/exam.tsx    # 报告槽换成自定义报告(与 view --report 同一文件)
```

`--eval` / `--execution` / `--diff`(`--diff=<文件路径>` 必须 `=` 连写,空格形式的下一个 token 会被当成 eval id 前缀)、`--experiment` / `--run` 收窄结果根或结果范围,`--report` 见 [Reports](../reports/README.md)。完整 flag 表见 [docs-site CLI 参考](../../../docs-site/zh/reference/cli.mdx)。

## 真实输出示例

下面一段是从一个真实下游项目(coding-agent-memory-evals)原样采集的终端会话,用于对照当前输出格式、发现措辞或对齐问题——迭代 `show` 的渲染逻辑时,先看这里的真实样子,再决定要不要改。

裸跑给出跨 experiment 的紧凑榜单;这次快照因为进程曾被中断,`show` 照样把已完成的 attempt 如实读出,只在最前面提示集合可能不完整:

```text
$ niceeval show
! snapshot "dev-e2b/codex-e2b" (2026-07-12T10:08:29.361Z) is unfinished (the process was interrupted); completed attempts are read as-is, but the set may be incomplete

At least 2 experiments needed to compare Cost × Pass rate

dev-e2b/codex-e2b · codex · gpt-5.4-mini
  Pass rate 66.7% · 4 passed / 2 failed · 6 attempts · 1m 58s · $0.17
  ✓ memory/agent-037-updatetag-cache   @160iuj3h✓[E,X,⏱,D]   2m 0s · $0.09
  ✓ memory/repomod-hello-world-api   @1sxmo0m1✓[E,X,⏱,D]   2m 58s · $0.57
  ✗ memory/swelancer-manager-proposals   @1qrdcfq8✗[E,X,⏱,D]   equals(4)
  ✓ memory/terminal-cancel-async-tasks   @1pcdj0az✓[E,X,⏱,D]   2m 48s · $0.13
  ✗ memory/terminal-pypi-server   @13wrnsc4✗[E,X,⏱,D]   commandSucceeded()
  ✓ memory/tool-call-observability   @18etnsw5✓[E,X,⏱,D]   18.1s · $0.02
```

Locator 必须带 `@` 前缀——裸传短码(漏了 `@`)不会被当成"大概是这个 attempt",而是明确报"没匹配上",并把当前可用的 eval id 全部列出来,不静默猜测:

```text
$ niceeval show 13wrnsc4
No results matched: 13wrnsc4. Evals with results: memory/agent-037-updatetag-cache, memory/repomod-hello-world-api, memory/swelancer-manager-proposals, memory/terminal-cancel-async-tasks, memory/terminal-pypi-server, memory/tool-call-observability
```

补上 `@` 后精确打开这个 attempt,给出紧凑全景——判定、断言概况、eval 源码位置、执行步骤计数、diff 摘要、每类证据的可用性,以及下一步命令提示:

```text
$ niceeval show @13wrnsc4
@13wrnsc4 · memory/terminal-pypi-server · dev-e2b/codex-e2b · failed
snapshot 2026-07-12T10:08:29.361Z · attempt 1 · 2m 53s · 205.7k tokens · $0.19

assertions: 1 gate failed
eval source: evals/memory/terminal-pypi-server.eval.ts · sha256:948bca32…

execution: 299 events · 0 skill loads · 27 tool calls · 16 AI messages
timing: OTel spans recorded for this attempt — see --execution for per-step timing.

changes: 6 files changed · M pyproject.toml, M setup.py, M simple/vectorops/index.html, M tests/run-tests.sh, M tests/test_outputs.py · +1 more

evidence: eval source [E] · execution [X] · OTel timing [⏱] · diff [D]
artifacts: .niceeval/dev-e2b_codex-e2b/2026-07-12T10-09-19-923Z-t3nr/memory/terminal-pypi-server/a0/
next: niceeval show @13wrnsc4 [--eval|--execution|--diff]
```

更多带 `--eval` / `--execution` / `--diff` 的完整样例(含 OTel 计时瀑布图、断言标回源码行、diff 摘要)见 [docs-site Agent 反馈闭环指南](../../../docs-site/zh/guides/agent-feedback-loop.mdx#用-bash-完成一次反馈闭环)。

## 相关阅读

- [README](README.md) —— show 是什么、locator 契约。
- [Results](../results/architecture.md) —— 这些字段读的是哪个落盘文件。
- [CLI](../../cli.md) —— `show` 命令在整个 CLI 里的分派位置(只读路径,不经调度核心)。
