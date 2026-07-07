# Results Lib —— 实验结果数据的读写库(设计提案,未实现)

> 状态:读取面已首版落地——`src/results/` 的 openResults / 快照 / latestPerExperiment / 身份键去重 / copyRun(源码入口见 [Source Map](source-map.md#results-lib-与-reports));写入面 `createRunWriter` 与 view / `Artifacts()` reporter 的收编仍是提案。[Results Format](results-format.md) 是磁盘上的格式规范(已实现);本文提议把这份格式的**读与写**抽成一个专门的库 `niceeval/results`,做 runner、view、[Reports](reports.md) 和用户脚本的共同数据层。

同一份磁盘格式,今天的写和读长在两个器官里。写在 `src/runner/reporters/artifacts.ts`:时间戳目录、attempt 路径清洗(evalId 保留 `/` 层级、agent/model 非 `[\w.@-]` 全换 `_`)、大字段拆工件、`artifactsDir` / `has*` 回填、空数据不落文件——全是它的私有知识。读长在 `src/view/index.ts`:`readSummary` 的版本判定、`loadSummaries` 的目录扫描、工件路径反拼。两边靠 `src/types.ts` 共享类型,但**布局知识各自实现了一遍**:格式演进要同步改两处,谁漏改谁坏。而用户侧根本没有读取 API,想编程消费只能第三次重写这些知识:

```typescript
// 今天:想比「谁的代码短」,只能手工爬目录
const summary = JSON.parse(readFileSync(".niceeval/2026-07-02T.../summary.json", "utf-8"));
for (const r of summary.results) {
  const diffPath = join(runDir, r.artifactsDir ?? "", "diff.json"); // 布局知识泄漏
  if (!existsSync(diffPath)) continue;                             // 存在性自己判断
  const diff = JSON.parse(readFileSync(diffPath, "utf-8"));        // 类型自己想
}
```

抽成一个专门的库,理由就是 TypeScript 最擅长的那件事:**写和读是同一组 interface 的两半,住在同一个包里,writer 的参数类型 = reader 的返回类型**——「写出去的就是读得回的」由编译器背书,布局知识(路径、清洗、拆分、版本)全宇宙只有一份实现。

## 库的边界

`niceeval/results` 拥有:

- **类型的家。** `RunSummary` / `EvalResult` / `StreamEvent` / `TraceSpan` / `O11ySummary` / `DiffData` 等结果类型和 `RESULTS_FORMAT` / `RESULTS_SCHEMA_VERSION` 常量搬进库;core 的 `src/types.ts` facade 反向 re-export,模块代码 `import type { … } from "../types.ts"` 的老习惯不破。
- **writer。** 目录创建、attempt 工件增量落盘、summary 收尾(见下)。
- **reader。** `openResults`:目录扫描、版本过滤、懒加载、快照切分、选择器(见下)。
- **身份。** attempt 身份键与去重规则——读写两侧对「同一个 attempt」的理解必须一致,所以住在这。

它不拥有:「看法」(聚合、指标、组件在 [Reports](reports.md))、渲染(view)、执行(runner)。库位于依赖图最底层,不 import core 的任何其它模块;必要时可以原样提成独立 npm 包(给「只想解析或产出 niceeval 结果的工具」用),但先作为子路径导出,不预设。

四个消费方:

| 消费方 | 用哪面 | 变化 |
|---|---|---|
| runner 的 `Artifacts()` reporter | 写 | 变薄壳:订阅 reporter 事件,转手调 writer,落盘行为不变 |
| `niceeval view` | 读 | `readSummary` / `loadSummaries` 改吃 reader,版本判定与 skipped 姿势顺带统一 |
| [Reports](reports.md) 的计算函数 | 读 | 第二档的全部数据入口 |
| 你的脚本 / 第三方工具 | 读、写、发布 | 读:自定义分析;写:把别家平台的结果转成 niceeval 格式,`niceeval view` 直接能看;发布:`copyRun` 瘦身快照进仓库 / CDN——兼容性都由库保证,不用抄格式文档 |

## 写:`createRunWriter`

```typescript
import { createRunWriter } from "niceeval/results";

const writer = await createRunWriter(".niceeval", {
  producer: { name: "niceeval", version: "0.12.0" },
});
writer.dir;                        // .niceeval/2026-07-07T…Z/(时间戳目录,: 与 . 已替换)

await writer.writeAttempt(result); // 吃完整 EvalResult(events / diff 等大字段内联):
                                   // 拆成 attempt 工件文件、算 artifactsDir(含路径清洗)、
                                   // 回填 has* 引用,返回瘦身后的条目;空数据不落文件

await writer.finish(summary);      // 写 summary.json,注入 format / schemaVersion / producer
```

attempt 工件按完成增量写入(与今天的行为一致):长 run 中途失败,已完成的 attempt 工件仍留在盘上。`writeAttempt` 做的「大字段拆出去、引用填回来」正是 reader 懒加载的逆操作——两个方向的同一份知识,终于写在同一个文件里。

## 复制与瘦身:`copyRun`

发布场景的第三个原语:把选中的快照(或整个 run)按格式感知地复制到另一个目录——只带指定工件、只带选中的 attempt,布局知识不外泄:

```typescript
import { copyRun } from "niceeval/results";

await copyRun(snapshots, "site/data/run", {
  artifacts: ["sources", "events", "trace"],   // diff 可达百 MB、o11y 查看器不读,发布时常见地不带
});
```

动机来自真实消费者:coding-agent-memory-evals 把最新 run 快照进仓库供静态托管,今天是 40 行手写脚本——按 `summary.json` 的 mtime 挑「最新」(口径还错了:该挑快照,不该挑 run),再按白名单拷贝工件文件(布局知识第三次泄漏)。`copyRun` 之后这段只剩上面三行,挑选交给 `latestPerExperiment`(见[静态导出场景](reports.md#dx-模拟))。复制忠实于源:不改内容、不消毒——发布消毒是自由文本的事,归 [Reports 的 `cases({ redact })`](reports.md#计算函数与数据契约)。

## 读:`openResults`

输入是 `.niceeval/` 目录(或单个 run 目录),输出是类型化句柄:

```typescript
import { openResults } from "niceeval/results";

const results = await openResults(".niceeval");

results.runs;                  // RunHandle[]:一个落盘 run 目录一项,忠实反映磁盘,不合并
results.snapshots;             // SnapshotHandle[]:experiment × run 的切片,选择与聚合的天然单元
results.skipped;               // 读不了的 run:{ dir, reason, producerVersion? }[],不静默丢

const run = results.runs[0];
run.dir;                       // 绝对路径
run.summary;                   // RunSummary(与写入侧同一类型)
run.attempts;                  // AttemptHandle[]:summary.results[] 逐条包一层

const attempt = run.attempts[0];
attempt.result;                // EvalResult 瘦身条目:判决、断言、用量、成本、experiment 元数据
await attempt.events();        // StreamEvent[] | null —— 重工件全部懒加载
await attempt.trace();         // TraceSpan[] | null
await attempt.o11y();          // O11ySummary | null
await attempt.diff();          // DiffData | null(可达百 MB,所以必须懒)
await attempt.sources();       // SourceArtifact[] | null
```

要点:

- **懒加载即存在性判断。** 工件缺失返回 `null`,不抛错。今天 summary 里只有 `hasEvents` / `hasTrace` / `hasSources`,连 `hasO11y` / `hasDiff` 标记都没有——这类不对称全被方法语义吸收,消费方不再碰路径。
- **版本过滤沿用格式规范。** 按 [Results Format 的版本规则](results-format.md#版本与升级设计)判定,不兼容的 run 进 `skipped` 并带 `producerVersion`(拼 `npx niceeval@<version> view` 提示的素材),与 [View 的报错与降级](view.md#报错与降级)同一姿势。
- **同一进程内按 handle 记忆化。** 两个都要读 diff 的消费方不会把「可达百 MB」的 `diff.json` 读两遍;扫全部历史仍然可能慢,但要慢得线性、可预期。
- **只读不写事实。** reader 的一切派生物删了随时可重算;唯一事实来源仍是磁盘上的 Results Format。

## 快照:experiment × run,不是 run

一次 CLI 调用写一个 run 目录,但一个 run 目录里可以装多个 experiment:`niceeval exp compare` 把整组对照跑进同一份 `summary.json`(runner 收的是 `agentRuns[]` 复数),顶层 `RunSummary.agent` 只是第一个配置的 agent(`src/runner/run.ts` 的 `summarize(allResults, firstAgent?.name …)`)。所以「每个 experiment 最新一次」没法用 run 粒度表达——周一跑了整组 compare,周二只重跑 `compare/bub-gpt-5.4`,bub 的最新快照在周二的 run 里,codex 的还在周一的 run 里。

reader 把这层身份显式化:**快照 = 一个 experiment 在一个 run 里的那部分 attempt**,与 [View · Compare 计划](view.md#compare-挑两次运行对比)的 `(experimentId, startedAt)` 同一口径:

```typescript
interface SnapshotHandle {
  experimentId: string;        // 结果里缺 experimentId 时以 "<agent>/<model>" 合成键,并记入 warnings
  run: RunHandle;              // 所属物理 run
  startedAt: string;
  agent: string;               // 本快照自己的 agent —— 不是 run 顶层那个「第一个配置」
  model?: string;
  attempts: AttemptHandle[];
  evalIds: string[];           // 覆盖的 eval 集合,供选择器做残缺检测(见下)
}
```

`results.runs` 忠实磁盘,`results.snapshots` 只切片、不合并、不去重;合并与聚合永远发生在消费方([Reports](reports.md) 的计算函数,或你自己的脚本),reader 不预设看法——这条教训来自 view 的 `aggregateRows` 把全部历史揉成一行的现状(见 [View · 已知差异](view.md#已知的文档-vs-实现差异))。

## 选择快照:`latestPerExperiment`

多数消费场景先回答「现在什么水平」,所以第一批只有一个选择器:

```typescript
function latestPerExperiment(
  snapshots: SnapshotHandle[],
  opts?: { experiments?: string | string[] },   // experiment id 前缀过滤,同 CLI 语义
): { snapshots: SnapshotHandle[]; warnings: string[] };
```

每个 experiment 取最新一次快照,最不误导。要累计历史就不调它;要更细的口径,普通 `.filter` 就够——选择器不是 DSL,只是最常用的那次筛选。

但「最新」可能残缺:位置参数允许只重跑一道题(`niceeval exp midterm algebra/quadratic` 是正常的 debug 姿势),它产出的「最新快照」只有一道题,安静吞下的话下游报表就变成按一道题打分。所以**选择器同样要诚实**:把每个选中快照的 `evalIds` 与该 experiment 历史快照的并集对比,缩水就写进 `warnings`:

```text
warning: snapshot "midterm/bub-gpt-5.4" @ 2026-07-05T… covers 1 of 50 evals seen in history.
  Re-run `niceeval exp midterm/bub-gpt-5.4` for a full snapshot, or pick another via .filter().
```

`warnings` 是普通字符串数组,渲染与否在消费方,但缺口永远被算出来,不静默。

## 身份键与去重

`--resume` 会把上一轮已通过的结果**原样合入**新 run 的 summary(`RunOptions.priorResults`):这让续跑出来的最新快照天然完整(正好配合 `latestPerExperiment`),代价是同一个 attempt 存在于多份落盘,而 `EvalResult` 今天没有任何「合入」标记。

reader 忠实反映这份重复,不擅自去重;**跨快照聚合前按身份键去重是消费方的义务**:

- 身份键:`(experimentId, evalId, attempt, startedAt)`,重复时保留最新 run 里的那份;
- `startedAt` 缺失时宁可不去重也不误删,并记入 warnings;
- [Reports 的计算函数](reports.md#计算函数与数据契约)内置这条;自己写脚本跨快照累计时,要么复用计算函数,要么自己按键去重。

更根治的做法是 writer 给合入的结果打标——读写同库之后,这类格式演进只改一处实现,再同步 [Results Format](results-format.md) 规范即可;是否值得为它递增 `schemaVersion`,留给格式规范那边定。

## 直接吃读取面:一个真实脚本

折叠类的看法(表格、矩阵、成绩单、散点)去用 [Reports](reports.md) 的计算函数;直接吃 reader 服务的是连算法都自定义的场景,比如「每个 agent 的 shell 命令分布直方图」——那是分布,不是折叠:

```typescript
import { openResults } from "niceeval/results";

const results = await openResults(".niceeval");
const points = [];
for (const snap of results.snapshots) {
  for (const attempt of snap.attempts) {
    const o11y = await attempt.o11y();
    points.push({
      agent: snap.agent,
      eval: attempt.result.id,
      passed: attempt.result.outcome === "passed",
      shellCommands: o11y?.shellCommands.length ?? 0,
    });
  }
}
```

即使在这条最深的路径上,用户也**不碰磁盘布局**——`artifactsDir` 拼接、存在性判断、版本过滤、快照切分都被库消化了。Results Format 若演进,全宇宙只有这一个库要改。

## 相关阅读

- [Results Format](results-format.md) —— 磁盘格式规范;本库是它唯一的官方读写实现,一格式一库,成对演进。
- [Reports](reports.md) —— 建立在本库读取面之上的积木:指标、计算函数、React 组件。
- [View](view.md) —— 内置前端;`readSummary` / `loadSummaries` / skipped 处理是本库 reader 要收编的现状。
- [Experiments](experiments.md) —— experimentId 与可对比组从哪来。
