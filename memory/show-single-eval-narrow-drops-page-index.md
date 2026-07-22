---
name: show-single-eval-narrow-drops-page-index
description: 位置参数把 show 收窄到恰好 1 个 eval 时，报告页切换成单题详情视图，尾部完全不附「Other pages」多页索引
metadata:
  node_type: memory
  type: project
---

**现象**：`niceeval show <多个 eval 都命中的前缀> --results <root>` 会在尾部打印
`Other pages:` 索引块（列出未渲染的 attempts/traces 页及可复制命令，见
`docs/feature/reports/show/reports.md` Case 2）。但换成一个**恰好只命中一个 eval**
的前缀（如仓库里唯一以 `tool-call` 开头的 eval），输出变成一段完全不同的单题详情视图
（题描述 + 该题下各 experiment 的 attempt 明细 + `artifacts:`/`attempt locator:`/`next:`
三行），从头到尾没有 `Other pages:` 索引块。

**根因**：`ExperimentComparison`（内建 report 页的主体）的 text 面在当前 Scope 只剩
一个 eval 时会自动"钻进"这道题的聚焦视图，这是一个真实存在、文档未单独章节化的展示
分支，不是页索引逻辑的 bug——只是这个分支恰好没有走到追加页索引的代码路径。

**修法/适用场景**：写 E2E 断言（`show --page` 相关的多页索引验收）时，选用一个会命中
**多个 eval** 的前缀（或干脆不收窄）来触发标准报告页 + 页索引的正常路径；只有测「单
eval 聚焦视图长什么样」这件事本身时才特意用单 eval 前缀，且不要断言它也带页索引。
已知会踩这个坑的场景：`e2e/report/scripts/verify-readback.ts`（B2，测 `--page`
索引命令），后续 B3（渲染结构/排版）、B5（自定义报告多页验收）如果也用位置参数收窄
到单一 eval 再检查页索引，会复现同一个"断言失败但其实是正常分支"的困惑。
