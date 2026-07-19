---
name: metric-views-compute-nul-byte-separator-blinds-grep
description: src/report/components/metric-views/compute.ts 里两处用真实 NUL 字节当 Map key 分隔符,导致 grep/rg 把整个文件当二进制、静默返回空结果
metadata:
  type: project
---

## 现象

`grep -n "^export "` / `rg -n "^export "` 对 `src/report/components/metric-views/compute.ts`(674 行,`metricTableData`/`metricMatrixData`/`scoreboardData`/`metricScatterData`/`metricLineData`/`deltaTableData`/`pairsByFlag` 等七个计算函数都在这里)返回**空**,`file` 把它判成 `data` 而不是文本。第一次撞见时容易误判成"文件为空/exports 被删掉了",实际文件完整、`pnpm run typecheck`/`pnpm test` 全绿。

## 根因

文件里有两处字面 `\x00`(真 NUL 字节,不是转义字符串)被当"绝对不会跟正常值撞车"的复合 key 分隔符使用:

- `metricLineData` 的 `bucketKey`(现 574 行左右,`` `${series ?? ""}\x00${x === null ? "null" : String(x)}` ``)
- `derivePairsByFlag` 的 `Entry.bucket`(现约 522 行,`` `${group}\x00${JSON.stringify(sortedJson(reduced))}` ``)

两处都确认是**函数内部临时 Map key**,构造完 bucket 后只消费 `.items`/`.id` 等字段,NUL 字符串本身从不流入 `LineData`/`DeltaPair` 等对外返回值——不是数据污染,纯粹是"分隔符选了一个人眼看不见、部分工具当二进制标记的字符"。

用 `git show <Phase-G 重组前的 commit>:src/report/compute.ts` 核对过:这两处 NUL 在 Phase G(vertical-slice 拆分,`3498d16`)之前的单体 `compute.ts` 里就已经存在,是原文件自带的写法,`git mv`+逐段抽取的拆分过程忠实保留了原字节,不是拆分引入的新问题。

## 影响与规避

任何要 grep/rg 这个文件(尤其在其它 agent 或工具流水线里)的场景,不带二进制标记参数会静默拿到空结果、误判"没匹配到"。规避:

- `grep -a` / `rg -a`(强制文本模式)可以正常匹配穿过 NUL。
- 或直接用 Read 工具整篇读,不受影响。

## 修法(未修)

功能上无害、也不在本次任务范围内(发现于 Phase H 文档同步,而非该文件本身的改动任务),按"发现问题记 memory、不顺手改无关代码"的原则未动。真要修,正确做法是把两处 NUL 分隔符换成 `JSON.stringify([a, b])` 这类真正防撞车的复合 key 构造(裸换成空格/`|` 等可打印分隔符会引入新的 key 碰撞风险,反而是退步),需要单独验证与提交,不要顺手当"清理"塞进无关 commit。
