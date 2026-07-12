# Experiments —— CLI

```sh
niceeval exp                       # 跑 experiments/ 下全部实验
niceeval exp compare               # 跑某一组(文件夹 compare/ 内全部配置,互为对照)
niceeval exp compare/bub-gpt-5.4   # 跑组里某一个配置
niceeval exp compare memory/retention  # 再用 eval id 前缀缩小到部分 eval
```

不写实验不能运行 eval。临时验证也写一个小的 `experiments/local.ts`;要换 agent 或 model,复制一个 experiment 文件改配置。

完整 flag 表(`--runs` / `--max-concurrency` / `--budget` / `--strict` 等调度覆盖)见 [docs-site CLI 参考](../../../docs-site/zh/reference/cli.mdx);`exp` 分支怎么把这些选项接进 Effect 调度核心见 [CLI 架构](../../cli.md)。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Library](library.md) —— 实验怎么按文件夹组织成可对比组。
