# Experiments —— CLI 用例

本目录是 `niceeval exp` 各输入面的用例文档(体裁约定见[功能文档](../../README.md)):一篇讲一个真实用例的全流程——用户遇到什么问题、带上这个输入之后从命令到结束反馈的完整路径、边界与何时改用别的模式。契约单源在 [CLI](../cli.md) 与 [Runner](../../../runner.md),这里只做叙事串联,不复制契约定义。

## 位置参数(选择器)

- [选择器 + `--dry`:几十个实验里只跑要跑的,先看清计划再花钱](selector-narrowing.md)

## `--output`(反馈模型)

- [`--output agent`:让 coding agent 驱动「跑→读失败→改→重跑」循环](output-agent.md)
- [`--output ci`:CI 门禁要稳定日志、单行结论、可归档产物](output-ci.md)

## 调度

- [`--budget`:一批长跑实验,给烧钱装安全网](budget.md)
- [`--max-concurrency`:本地资源耗尽或 provider 限流,收并发](max-concurrency.md)

## 判定

- [`--early-exit`:只想知道能不能做到,不为通过率分布跑满](early-exit.md)

## 缓存

- [`--force`:指纹未变但外部世界变了,全量重验](force.md)

## 对比怎么计分

一个实验选中的 eval 必须同一题型:通过制实验(`defineEval`)读通过率,一题一分、`runs > 1` 按通过率折叠;计分制实验(`defineScoreEval`)读总分,题内叠加挣分;混型选择是启动期配置错误。「死在哪层」「部分完成」「质量差」各有下钻读法,契约见[计分粒度](../score-points.md)。
