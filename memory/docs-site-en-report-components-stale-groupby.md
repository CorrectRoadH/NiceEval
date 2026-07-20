---
name: docs-site-en-report-components-stale-groupby
description: docs-site/reference/report-components.mdx（英文）ExperimentComparison 一节仍描述已否决的按父目录分组设计,且引用不存在的 ExperimentComparison.data() 静态方法,需要独立重写
metadata:
  type: project
---

**现象**：`docs-site/reference/report-components.mdx`（英文入口，非 `docs-site/zh/`）第 15、99-104、150、338 行左右，把 `ExperimentComparison` 描述成"Grouped by the experiment id's full parent directory; each group gets its own summary, scatter plot, and experiment list"，并给出 `<ExperimentComparison data={await ExperimentComparison.data(selection)} />` 这样的调用示例。

**根因**：当前实际契约（`docs/feature/reports/library/summaries.md`、[[default-report-partitions-experiment-groups]]）是"默认报告取消实验组，直接比较当前 Scope"——`groupBy` 这个按目录分组的设计在 [[reports-external-review-rulings]] 里已被否决。英文页描述的是那个被否决前的旧设计，且 `ExperimentComparison` 是纯 report-only 组合组件、不从 `niceeval/report/react` 导出、没有自己的 `.data()`（这点数据形态本身也在 `summaries.md` 明确写了"不发明自己的 data 形状")。这是与 [[docs-renames-dont-auto-propagate-to-docs-site]] 同一类问题的又一处实例，之前那次扫过 `--eval`→`--source` 改名，没扫到这处更早的分组语义漂移。

**修法（未做，留给下次专项 sweep）**：不要照抄现有英文段落小修，要对照 `docs/feature/reports/library/summaries.md` 与 `docs-site/zh/reference/report-components.mdx` 的 `ExperimentComparison` 一节重写；同时检查同文件里其它组件段落（`MetricScatter` 等）是否也在讲这个旧 grouping 模型（第 338 行同样提到"默认 ExperimentComparison first narrows to one comparable group, then calls it once per group"）。改完在 dogfood repo（`/Users/ctrdh/Code/coding-agent-memory-evals`）用 `niceeval show --report` 验证示例代码可执行。

关联：[[docs-renames-dont-auto-propagate-to-docs-site]]、[[experimentcomparison-relativeto-cosmetic-vs-groupby]]（本次顺带发现，未修复）。
