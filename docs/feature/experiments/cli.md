# Experiments —— CLI 预期反馈

```sh
niceeval exp                            # 跑 experiments/ 下全部实验
niceeval exp compare                    # 跑某一组(文件夹 compare/ 内全部配置,互为对照)
niceeval exp compare/bub-gpt-5.4        # 跑组里某一个配置
niceeval exp compare memory/retention   # 再用 eval id 前缀缩小到部分 eval
```

不写实验不能运行 eval。临时验证也写一个小的 `experiments/local.ts`;要换 agent 或 model,复制一个 experiment 文件改配置。

完整 flag 表见 [docs-site CLI 参考](../../../docs-site/zh/reference/cli.mdx)。本页用“执行命令 → 预期输出”定义 `exp` 的终端反馈;示例里的 `<耗时>`、`<token>`、`<成本>`、时间戳和 spinner 帧是动态值,`…` 表示按同一格式省略的行。

## 默认:交互终端使用 Live 状态表

```sh
niceeval exp compare --max-concurrency 19
```

运行中在 `stderr` 原地显示一帧 Live 状态,而不是不断追加新帧:

```text
  正在处理 45 个 attempt (9 eval × 5 配置,并发 19) · 本次运行 39 · 复用 6 · 8/45 已解决
  ⠼ memory/agent-029-use-cac [compare/bub-e2b]       0/1  正在启动 sandbox…
  ⠼ memory/agent-030-app-rou [compare/bub-e2b]       0/1  正在启动 sandbox…
  · memory/agent-037-updatet [compare/bub-e2b]       0/1  排队等待中…
  · memory/commit0-cachetool [compare/bub-e2b]       0/1  排队等待中…
  … 其余 41 项(17 运行中 · 20 等待 · 4 已完成)
```

这里的数字口径固定为:

- `45` 是选中矩阵的逻辑 attempt 总数;
- `39` 是扣除缓存携入后真正需要派发的数量;
- `6` 是从上次快照复用的数量;
- `8/45` 是已经有终态的逻辑数量,包含复用结果和本次已完成结果。

如果没有复用,表头省略“复用”,本次运行数等于总数:

```text
  正在处理 45 个 attempt (9 eval × 5 配置,并发 19) · 0/45 已解决
```

Live 区域必须始终放得进当前终端视口。放不下时只保留当前最有用的行并显示“其余 N 项”摘要;窄终端截断列,不换出额外物理行。spinner 刷新只能覆盖上一帧,历史帧不得进入 scrollback。独立警告出现时先撤下 Live,打印警告,再在警告下方重建 Live。

全部完成后先清除 Live 区域,再在 `stdout` 打印稳定的最终汇总和结果快照路径:

```text
实验
实验                  模型       Agent      平均耗时   成功率   Tokens   成本       结果
compare/bub-e2b       gpt-5.4    bub        <耗时>     89%      <token>  <成本>     8 通过 · 1 失败
compare/codex         gpt-5.4    codex      <耗时>     100%     <token>  <成本>     9 通过
…

Eval · compare/bub-e2b
状态    Eval                         原因             耗时     Tokens   成本       Runs
通过    memory/agent-029-use-cac                      <耗时>   <token>  <成本>     1/1
失败    memory/agent-030-app-rou     gate 未通过      <耗时>   <token>  <成本>     0/1
…

结果:44 通过,1 失败,0 跳过  (<耗时> · <token> tok · <成本>)
运行 `pnpm exec niceeval view` 以图形化查看结果。

结构化结果:.niceeval/compare/bub-e2b/<时间戳>(snapshot.json + 每 attempt 的 result.json / events.json / trace.json / diff.json)
结构化结果:.niceeval/compare/codex/<时间戳>(snapshot.json + 每 attempt 的 result.json / events.json / trace.json / diff.json)
…
```

## 管道或 CI:纯文本输出

```sh
niceeval exp compare memory/agent --max-concurrency 2 2>&1 | tee niceeval.log
```

`stderr` 不是 TTY 时不使用 spinner、清行或光标上移。输出只追加,每一行自带 experiment / eval 归属:

```text
本次运行 2 个 eval × 2 配置 = 4 次运行(并发 2)

  · memory/agent-029-use-cac [compare/bub-e2b] 正在启动 sandbox…
  · memory/agent-030-app-rou [compare/bub-e2b] 排队等待中…
  ✓ memory/agent-029-use-cac  [bub/gpt-5.4]  (<耗时>  <token> tok  <成本>)
  · memory/agent-030-app-rou [compare/bub-e2b] 正在启动 sandbox…
  ✓ memory/agent-029-use-cac  [codex/gpt-5.4]  (<耗时>  <token> tok  <成本>)
  …

实验
…
结果:4 通过,0 失败,0 跳过  (<耗时> · <token> tok · <成本>)

结构化结果:.niceeval/compare/bub-e2b/<时间戳>(snapshot.json + 每 attempt 的 result.json / events.json / trace.json / diff.json)
结构化结果:.niceeval/compare/codex/<时间戳>(snapshot.json + 每 attempt 的 result.json / events.json / trace.json / diff.json)
```

并发完成顺序可以变化,但最终表格按发现顺序稳定排列,不按完成先后漂移。机器下游读取结果快照或 `--json` / `--junit`,不解析这段人读文本。

## `--dry`:只看选择结果

```sh
niceeval exp compare memory/agent --runs 3 --dry
```

只在 `stdout` 打印匹配到的矩阵,不调用 agent、不创建快照,也不写 `--json` / `--junit`:

```text
[dry] 2 个 eval × 2 个运行配置:
  bub/gpt-5.4 (exp compare/bub-e2b): memory/agent-029-use-cac, memory/agent-030-app-rou  ×3
  codex/gpt-5.4 (exp compare/codex): memory/agent-029-use-cac, memory/agent-030-app-rou  ×3
```

`--tag` 和 eval id 前缀只收窄这里及真实运行中的矩阵:

```sh
niceeval exp compare memory/agent --tag smoke --dry
```

```text
[dry] 1 个 eval × 2 个运行配置:
  bub/gpt-5.4 (exp compare/bub-e2b): memory/agent-029-use-cac  ×1
  codex/gpt-5.4 (exp compare/codex): memory/agent-029-use-cac  ×1
```

## `--runs` 与首过即停

```sh
niceeval exp compare/bub-e2b memory/agent-029 --runs 3
```

默认启用首过即停。第一次通过后,该行直接进入终态并说明剩余次数没有派发,不能停在 `1/3` spinner:

```text
  ✓ memory/agent-029-use-cac [compare/bub-e2b]       1/3  通过;首过即停,其余 2 次未派发
```

最终汇总中的 Runs 只统计真实结果:

```text
状态    Eval                         原因   耗时     Tokens   成本       Runs
通过    memory/agent-029-use-cac            <耗时>   <token>  <成本>     1/1
```

关闭首过即停会跑满三次:

```sh
niceeval exp compare/bub-e2b memory/agent-029 --runs 3 --no-early-exit
```

```text
  ✓ memory/agent-029-use-cac [compare/bub-e2b]       3/3
…
状态    Eval                         原因   耗时     Tokens   成本       Runs
通过    memory/agent-029-use-cac            <耗时>   <token>  <成本>     2/3
```

显式 `--early-exit` 与默认行为相同。

## 缓存复用与 `--force`

默认运行会在 Live 之前列出复用清单:

```sh
niceeval exp compare
```

```text
  · 复用上次 6 个已判定的结果,重跑 39 个 eval
      复用 [compare/bub-e2b] memory/agent-029-use-cac, memory/agent-030-app-rou
      复用 [compare/codex] memory/agent-029-use-cac
      …
```

`--force` 不显示复用清单,所有匹配项都进入待运行状态:

```sh
niceeval exp compare --force
```

```text
  正在处理 45 个 attempt (9 eval × 5 配置,并发 19) · 0/45 已解决
  ⠋ memory/agent-029-use-cac [compare/bub-e2b]       0/1  正在启动 sandbox…
  …
```

## 并发、超时与预算

`--max-concurrency` 的生效值出现在表头;未抢到名额的行用 `·` 和“排队等待中”,不用 spinner:

```sh
niceeval exp compare --max-concurrency 2
```

```text
  正在处理 45 个 attempt (9 eval × 5 配置,并发 2) · 0/45 已解决
  ⠋ memory/agent-029-use-cac [compare/bub-e2b]       0/1  正在启动 sandbox…
  ⠋ memory/agent-030-app-rou [compare/bub-e2b]       0/1  正在启动 sandbox…
  · memory/agent-037-updatet [compare/bub-e2b]       0/1  排队等待中…
```

单个 attempt 超时显示为 `errored`,并包含生效边界;其它组合继续运行:

```sh
niceeval exp compare/bub-e2b memory/agent-029 --timeout 60000 2>&1 | cat
```

```text
本次运行 1 个 eval(并发 <并发数>)

  ! memory/agent-029-use-cac 执行错误  [bub/gpt-5.4]  (1m 0s  — tok)
      ! 错误:attempt 超时(60000ms)
      最近进度:
      正在运行测试…
…
结果:0 通过,0 失败,1 执行错误,0 跳过  (1m 0s · — tok)
```

预算到顶后说明 experiment、已知花费和未派发数量:

```sh
niceeval exp compare/bub-e2b --budget 1.00
```

```text
  budget 已到达 [compare/bub-e2b]:已知花费 $1.03,停止派发其余 4 个 attempt
  ~ memory/agent-037-updatet [compare/bub-e2b]       0/1  budget 到顶,未派发
```

连续多个结果没有成本数据时只警告一次,然后取消该 experiment 的预算护栏继续跑:

```text
compare/bub-e2b 的 budget:连续多个 attempt 完成后都拿不到成本数据——budget 无法执行,取消护栏继续跑。
```

## `--strict`:soft 断言影响 verdict

```sh
niceeval exp compare/bub-e2b memory/agent-029 --strict 2>&1 | cat
```

soft 断言失败必须保留 `soft` 归因,同时把 eval 显示为失败:

```text
  ✗ memory/agent-029-use-cac 失败  [bub/gpt-5.4]  (<耗时>  <token> tok  <成本>)
      - soft: context retained (得分 0.60 < 0.80)
…
结果:0 通过,1 失败,0 跳过  (<耗时> · <token> tok · <成本>)
```

不带 `--strict` 时同一 soft 断言仍列入证据,但不会单独把 eval 判为失败。

## `--quiet`:最小终端反馈

```sh
niceeval exp compare --quiet
```

不画 Live、不打印逐条成功结果和末尾汇总。必要的 attempt 进度、失败、执行错误和关键诊断仍写 `stderr`;快照路径仍写 `stdout`:

```text
  · memory/agent-029-use-cac [compare/bub-e2b] 正在启动 sandbox…
  ✗ memory/agent-030-app-rou [compare/bub-e2b] failed
  ! memory/agent-037-updatet [compare/codex] errored — attempt 超时(60000ms)
结构化结果:.niceeval/compare/bub-e2b/<时间戳>(snapshot.json + 每 attempt 的 result.json / events.json / trace.json / diff.json)
结构化结果:.niceeval/compare/codex/<时间戳>(snapshot.json + 每 attempt 的 result.json / events.json / trace.json / diff.json)
```

`--quiet` 不是静默丢弃错误。如果需要保存完整的机器结果,和 `--json` 或 `--junit` 组合使用。

## `--json` 与 `--junit`

```sh
niceeval exp compare --quiet --json .niceeval/summary.json --junit .niceeval/junit.xml
```

终端仍采用 `--quiet` 的输出;成功收尾后额外生成两个文件:

```text
.niceeval/summary.json   # RunSummary JSON,无 ANSI、无本地化展示字符串
.niceeval/junit.xml     # testcase 名称可定位 experiment 与 eval
```

不带 `--quiet` 时两项也不改变 Live 或最终汇总。额外 reporter 写失败时给出带路径与阶段的诊断,但不抹掉已经完成的 eval 结果:

```text
reporter onRunComplete 失败(.niceeval/summary.json): EACCES: permission denied
```

`--dry` 不创建这两个文件。

## 用法错误

`exp` 不接受临时 `--agent` / `--model` 覆盖:

```sh
niceeval exp compare --model gpt-5.4
```

```text
experiment 运行不支持 --model。请新增或复制一个 experiment 文件并修改 model。
```

```sh
niceeval exp compare --agent codex
```

```text
experiment 运行不支持 --agent。请在 experiments/ 下新增或复制一个配置文件。
```

没有匹配的 experiment 时列出选择器,不创建快照:

```sh
niceeval exp missing
```

```text
没有匹配 experiment:missing
```

标为 `show` / `view` 专用的 flag 也不能被 `exp` 静默忽略:

```sh
niceeval exp compare --history
```

```text
--history 只适用于 niceeval show,不能用于 niceeval exp。
```

以上用法错误写 `stderr` 并以非零状态退出。`--help` / `--version` 只打印帮助或版本,不加载 experiment、不显示进度、不创建结果。

## 退出码

退出码按 `(experiment, eval)` 折叠,不按单个 attempt 判定。同一组合的多次 attempt 中任一次通过,该组合即通过;被后续通过吸收的早期失败不把进程判红。仍有 `failed` / `errored` 的组合时退出 `1`,全部通过时退出 `0`;用法错误、运行时崩溃和用户中断的通用退出码见 [CLI 参考](../../../docs-site/zh/reference/cli.mdx#退出码)。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Library](library.md) —— 实验怎么按文件夹组织成可对比组。
- [Runner](../../runner.md) —— 矩阵展开、并发、首过即停、预算与结果顺序。
