# `--results` / `--snapshot`:换结果根,或只看一份快照

## 解决什么问题

`show` 与 `view` 默认读当前项目的结果根,但结果不总在原地:一类是可信边界内搬动的事实根拷贝——比如整个 `.niceeval/` 作为 CI job artifact 取回本机,搬目录即可,不经发布管线;另一类是 [`copySnapshots`](../../results/library.md#复制与瘦身copysnapshots) 为对外发布构出的发布根。两类都是普通结果根目录,`--results` 一视同仁地当结果根打开。而调试一次历史执行时,整根里几十份快照又太吵,`--snapshot` 只装载一份快照文件。两个 flag 都不占用位置参数([契约](../view.md#打开与收窄))。

## 全流程

1. 对着别的目录打开。`--results <dir>` 在 `show` 与 `view` 是同一个 flag,改变的都是结果根:

   ```bash
   niceeval view --results site-data/run  # 换结果根
   niceeval show --results tmp/published-results
   ```

   `show` 输出的页索引命令会保留 `--results`,复制粘贴不丢上下文。

2. 只看一份历史快照,不让根里其它结果混进 Scope:

   ```bash
   niceeval view --snapshot .niceeval/dev-e2b_codex-e2b/2026-07-12T10-08/snapshot.json
   ```

3. 扫描整个结果根时容错:单个不可读快照不会挡住其它结果,每个被跳过的快照形成一条 `unreadable-snapshot` Scope warning(含目录与原因),由页内的 `ScopeWarnings` 组件与其它选择警告一起显示;非 niceeval JSON 直接忽略,schemaVersion 不兼容的跳过并建议用产出它的版本打开,损坏的标为 malformed([逐场景行为表](../view.md#结果版本与错误))。

4. `show` 侧完全没有可读结果时命令非零退出,并对带 `producer.version` 的旧格式给出对应版本的 `npx niceeval@<version> show --results <root>` 建议([契约](../show.md#无匹配与不可读结果))。

## 边界

- 用 `--snapshot` 明确指定单个快照文件时,该文件不可读会让命令失败——明确点名的东西坏了不静默跳过。
- 读取不会迁移或改写历史结果。
- 收窄只有前缀语义。按任意谓词挑选快照、按证据种类瘦身,先用 [`copySnapshots`](../../results/library.md#复制与瘦身copysnapshots) 构建发布根,再对发布根打开或导出([用例](view-out-publish.md))。

## 相关阅读

- [View · 结果版本与错误](../view.md#结果版本与错误) —— 不可读快照的逐场景行为表。
- [Show · 无匹配与不可读结果](../show.md#无匹配与不可读结果) —— 终端侧的同一套规则。
- [Results Lib](../../results/library.md) —— `openResults`、`copySnapshots` 与结果根的脚本消费。
