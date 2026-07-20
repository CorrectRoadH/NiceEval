---
name: experimentcomparison-relativeto-cosmetic-vs-groupby
description: ExperimentComparison 加 relativeTo prop 被接受,与之前否决的 groupBy 不是同一类请求——区分标准是"改显示"还是"改语义"
metadata:
  type: project
---

**裁决(2026-07-20)**：`ExperimentComparison` 加 `relativeTo?: string`，原样透传给内部 `ExperimentList`（`src/report/components/summaries/index.tsx`）。契约见 `docs/feature/reports/library/summaries.md`「`ExperimentComparison`」与 `docs/engineering/unit-tests/reports/cases.md`。

**背景**：用户维护的下游 eval 仓库（`coding-agent-memory-evals`）所有 `compare/*` experiment id 共享 `compare/` 前缀，`ExperimentComparison`（default report 首页用的零配置组合件）此前无法去掉这段前缀显示，只能显示完整 id。

**为什么这次不是 [[reports-external-review-rulings]] 里否决的 `groupBy` 同款请求**：表面都是"给 ExperimentComparison 加一个 prop"，但两者改变的东西不同——

- `groupBy`（已否决）是**结构性**的：会引入组边界、组选择器/组索引，改变「一份 Scope 只有一份摘要/散点/列表」的不变量，且与「路径即分组 API，要分组就让 id 带路径」的产品立场冲突。
- `relativeTo`（本次接受）是**纯展示层**的：只缩短 `ExperimentList` 行标签文字，不引入分组、不改变排序键/过滤匹配/折叠展开依据的完整 id，`ScopeSummary`/`MetricScatter` 完全不受影响。而且 `relativeTo` 是`ExperimentList` 自己早就有的公开 prop（`docs/feature/reports/library/entity-lists.md`），这次只是让 `ExperimentComparison` 把它透传下去，不是发明新语义。

**教训**：评审/用户说"给零配置组件加个 X"时，不能只看请求的语法形状（"加个 prop"）就套用旧裁决；要看这个 prop 改的是渲染层展示还是数据/语义边界。判据：会不会引入新的分组/选择器 UI、会不会改变排序/过滤/身份键——改的话套用 `groupBy` 先例（用组合逃生门），只改文字显示不套用。

关联：[[reports-external-review-rulings]]（`groupBy` 否决的原始记录）、[[default-report-partitions-experiment-groups]]（路径不做分组的设计基础）。
