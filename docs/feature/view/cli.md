# View —— CLI 预期反馈

`niceeval view` 的位置参数 / `--out` 精确行为,以及读不到结果或结果版本不兼容时终端打印什么。

## 位置参数与 `--out`

位置参数按存在性判定:指向存在的文件 → 单文件模式,只看这一份快照(不与 `--run` 或其它位置参数混用);指向存在的目录 → 报错直说走 `--run`;其余按 eval id 前缀处理,收窄报告槽 Selection(与 `show` 同语义),证据室数据与 attempt 深链恒为全量、不受收窄影响。

`--out` 只支持目录式导出,不支持单个 HTML 文件:代码 / transcript / trace 视图依赖 artifact 文件,单文件必然是残缺体验,而这些视图恰恰是 coding eval 最依赖的证据。「传一份文件给同事」的需求,答案是把整站导出托管起来发链接,或用 [Reports](../reports/README.md) 积木在 CI 里落判定数据。`--out` 目标以 `.html` 结尾时 CLI 直接报错,并给出改法提示。

## 结果版本机制

### 报错与降级

`view` 有两种入口,错误处理不同:

- **读整个 `.niceeval/` 目录。** 遇到某个快照读不了,不要让整个页面失败。目录扫描收集 `skipped`(三种原因:incompatible-version / malformed / incomplete),继续渲染其它快照,并在页面顶部显示一条可展开提示:哪些快照被跳过、原因是什么、建议怎么处理。
- **读单个 `snapshot.json`。** 这是用户明确指定的目标,读不了就应该让命令失败,打印可执行的下一步,不要打开一个空页面。

错误分类:

| 场景 | 行为 | 文案要点 |
|---|---|---|
| 没有 `format` 字段,也不满足 legacy 的 `results[]` + `startedAt` 启发式 | 当作无关 JSON 忽略 | 不出现在 skipped 列表里 |
| `format` 是 `"niceeval.results"` 但 `schemaVersion` 不同(含历史版本的 run 级 `summary.json`) | 跳过,标为 incompatible-version | 拼出 `npx niceeval@<producer.version> view <目录>` 命令 |
| `snapshot.json` 是坏 JSON,或必需字段类型错误 | 跳过,标为 malformed | 说明快照可能损坏,给出文件路径 |
| 有 attempt 落盘、没有 `snapshot.json` | 跳过,标为 incomplete | 说明快照元数据没写完(进程中断或人为删文件) |
| attempt artifact 缺失,例如 `events.json` 不存在 | 页面仍可打开 | 只在展开该 attempt 时显示「artifact missing」 |

命令行错误要给到具体命令,例如:

```text
⚠ .niceeval/2026-07-10T08-00-00-000Z: written by niceeval 0.4.6 (schemaVersion 3);
  this CLI reads schemaVersion 4.
  Run `npx niceeval@0.4.6 view .niceeval/2026-07-10T08-00-00-000Z` to view it.
```

单文件模式指向版本不同的 `snapshot.json` 时输出同样的提示后退出,而不是报「不是 niceeval 结果」。如果 `producer.version` 缺失,文案退化成「upgrade niceeval」或「try an older niceeval matching when the report was created」,不要编造版本号。

**这套版本机制是 results 层的通用能力,不是 view 专属。** `niceeval show` 裸跑零可读结果时,`skipped` 目录同样按上表分类展示;niceeval 自己写的、schemaVersion 不兼容的部分额外给出可执行建议——但 `show` 没有 view 的单快照直读模式,`--run` 认的是结果根(其下可以有多个 experiment,不是单个快照目录),所以不对每份落盘各拼一条命令,而是按 `producer.version` 分组、每组一条 `npx niceeval@<version> show --run <结果根>`,同版本的多份快照合并成一行,不重复刷屏。分组实现在中性层(`src/results/skipped-notice.ts` 的 `groupIncompatibleVersionSkips`),`show` 侧文案在 `src/show/render.ts` 的 `skippedRunsText`,`view` 侧文案(逐条给出,因为 view 支持精确打开某一份快照)仍是 `src/view/data.ts` 的 `noReadableResults`。

版本不匹配没有隐式迁移:eval 结果是审计材料,原地改写会让「当时到底写出了什么」变模糊,view 是读工具,不应该因为想看结果而修改 `.niceeval/`。`niceeval clean` 也不是迁移工具,只负责删除当前项目的历史运行结果——适合用户明确表示「旧结果不要了,只想让 view 干净」的场景,不在 view 报错时自动执行。

## 相关阅读

- [README](README.md) —— `niceeval view` 是什么、位置参数与 `--out` 的整体语义、报告槽 + 证据室的定位。
- [Architecture](architecture.md) —— 结果版本机制的内部设计,以及 view 怎么用 Reports 积木搭报告槽。
- [Results](../results/architecture.md) —— view 读取的快照 `snapshot.json` 与 attempt 级 `result.json` / JSON artifact 格式。
