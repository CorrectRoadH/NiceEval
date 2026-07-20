---
name: metric-views-compute-nul-byte-separator-blinds-grep
description: src/report/components/metric-views/compute.ts 里两处用真实 NUL 字节当 Map key 分隔符,导致 grep/rg 把整个文件当二进制、静默返回空结果
metadata:
  type: project
---

## 现象

`grep -n "^export "` / `rg -n "^export "` 对 `src/report/components/metric-views/compute.ts`(674 行,`metricTableData`/`metricMatrixData`/`scoreboardData`/`metricScatterData`/`metricLineData`/`deltaTableData`/`pairsByFlag` 等七个计算函数都在这里)返回**空**,`file` 把它判成 `data` 而不是文本。第一次撞见时容易误判成"文件为空/exports 被删掉了",实际文件完整、`pnpm run typecheck`/`pnpm test` 全绿。

## 根因

这是仓库里一处**故意的**写法惯例,不是损坏:用字面 `\x00`(真 NUL 字节,不是转义字符串)当"绝对不会跟正常值撞车"的复合 key 分隔符,拼接两个来源不可控的字符串字段(experiment id、版本号、series 名……)成一个 Map key / React key / 哈希输入,回避可打印分隔符(空格、`/`、`|`)可能出现在字段值本身里造成的错位碰撞。除 `metric-views/compute.ts` 外,同一手法至少还见于:

- `src/results/locator.ts`(`` `niceeval.attempt-locator.v${CURRENT_SCHEME}\x00${canonical}` ``,喂进哈希输入)
- `src/results/skipped-notice.ts`(`` `${s.producer.version}\x00${s.schemaVersion ?? ""}` ``,分组 Map key)
- `src/report/components/entity-lists/EvalList.tsx`(`` key={`${item.experimentId}\x00${item.evalId}`} ``,React key)

`metric-views/compute.ts` 内原有两处:`metricLineData` 的 `bucketKey`(`` `${series ?? ""}\x00${x === null ? "null" : String(x)}` ``)和(2026-07-19 之前)`derivePairsByFlag` 的 `Entry.bucket`。全部确认是**函数内部临时 key**,构造完 bucket 后只消费 `.items`/`.id` 等字段,NUL 字符串本身从不流入 `LineData`/`DeltaPair` 等对外返回值——不是数据污染。

用 `git show <Phase-G 重组前的 commit>:src/report/compute.ts` 核对过:`metric-views/compute.ts` 这两处 NUL 在 Phase G(vertical-slice 拆分,`3498d16`)之前的单体 `compute.ts` 里就已经存在,是原文件自带的写法,`git mv`+逐段抽取的拆分过程忠实保留了原字节,不是拆分引入的新问题。

## 差点踩的坑(2026-07-19,实现 Grid/Stat 时顺手改 `pairsByFlag` 撞见)

改 `derivePairsByFlag`(移除 `experimentGroupOf` 分组,详见 commit)时,Edit 工具对含反引号模板字面量、多个 `${}` 插值的 old_string 反复报"匹配不到",还提示"试过交换 \uXXXX 转义"——排查发现是 Edit 工具自己在**之前一次不相关的调用**里,把 `metricLineData` 的 `bucketKey` 那行悄悄写坏成了这份 NUL 字节(`git diff` 显示"无变化"、终端/编辑器渲染不出任何差异,只有逐字节 `python3 ... data.count(b"\x00")` 或 `xxd` 能看见)。第一反应是"这是 bug,我用空格修一下"——**这个反应是错的**:先查这份 memory 才发现 NUL 是这个代码库的故意惯例,换成空格会引入本条目开头说的碰撞风险,是倒退不是修复。已 revert 回原始 NUL 字节(`git checkout -- <path>` 回到 HEAD 再用 python 逐字节精确替换重放意图中的改动,不复用会踩同一个 bug 的 Edit 工具大块 old_string)。

**教训**:
1. 在这个仓库里撞见"看起来像应该是空格/分隔符,但 diff 显示怪异或 Edit 工具莫名匹配失败"的位置,先查这条 memory,不要凭直觉当 corruption 修掉。
2. Edit 工具处理含多个 `${}` 插值的反引号模板字面量 old_string 时不可靠,确认匹配失败后不要重试同一个大块 old_string——换成逐字节精确的脚本操作(python `rb`/`wb` 模式 + `assert data.count(old) == 1`),或拆成不含反引号的最小片段。

## 影响与规避

任何要 grep/rg 这些文件(尤其在其它 agent 或工具流水线里)的场景,不带二进制标记参数会静默拿到空结果、误判"没匹配到"。规避:

- `grep -a` / `rg -a`(强制文本模式)可以正常匹配穿过 NUL。
- 或直接用 Read 工具整篇读,不受影响。

## 修法(未修)

功能上无害,是故意的写法惯例,不需要修。真要统一改成别的复合 key 构造(如 `JSON.stringify([a, b])`),裸换成空格/`|` 等可打印分隔符**是退步**(见上面"差点踩的坑"),需要单独验证与提交,不要顺手当"清理"塞进无关 commit。
