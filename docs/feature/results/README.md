# Results —— 结果的磁盘格式与读写库

这是 results 功能的总览:为什么一份磁盘快照格式与读写它的库是同一件事、库的边界在哪、谁在消费它。磁盘上的格式规范见 [Architecture](architecture.md);`niceeval/results` 的 TS 读写 API 见 [Library](library.md)。

[Architecture](architecture.md) 是磁盘上的格式规范;本库是这份格式的**读与写**的唯一实现 `niceeval/results`,做 runner、view、[Reports](../reports/README.md) 和用户脚本的共同数据层。

抽库前,同一份磁盘格式的写和读长在两个器官里。写在 `src/runner/reporters/artifacts.ts`:快照目录、attempt 路径清洗(evalId 保留 `/` 层级、非 `[\w.@-]` 全换 `_`)、大字段拆 artifact、引用回填、空数据不落文件——全是它的私有知识。读长在 `src/view/index.ts`:版本判定、目录扫描、artifact 路径反拼。两边靠 `src/types.ts` 共享类型,但**布局知识各自实现了一遍**:格式演进要同步改两处,谁漏改谁坏。用户侧则根本没有读取 API,想编程消费只能第三次重写这些知识:

```typescript
// 抽库前:想比「谁的代码短」,只能手工爬目录
const record = JSON.parse(readFileSync(".niceeval/compare_bub/2026-07-11T.../weather/brooklyn/a0/result.json", "utf-8"));
const diffPath = join(attemptDir, "diff.json");   // 布局知识泄漏
if (!existsSync(diffPath)) { /* 存在性自己判断 */ }
const diff = JSON.parse(readFileSync(diffPath, "utf-8"));  // 类型自己想
```

抽成一个专门的库,理由就是 TypeScript 最擅长的那件事:**写和读是同一组 interface 的两半,住在同一个包里,writer 的参数类型 = reader 的返回类型**——「写出去的就是读得回的」由编译器背书,布局知识(路径、清洗、拆分、版本)全宇宙只有一份实现。

## 库的边界

`niceeval/results` 拥有:

- **类型的家。** `EvalResult` / `StreamEvent` / `TraceSpan` / `O11ySummary` / `DiffData` 等结果类型和 `RESULTS_FORMAT` / `RESULTS_SCHEMA_VERSION` 常量搬进库;core 的 `src/types.ts` facade 反向 re-export,模块代码 `import type { … } from "../types.ts"` 的老习惯不破。
- **writer。** 快照目录独占创建、快照级元数据落盘、attempt 记录与 artifact 增量落盘、收尾补 `completedAt`(见 [Library · 写:`createResultsWriter`](library.md#写createresultswriter))。
- **reader。** `openResults`:目录扫描、版本过滤、懒加载、实验/快照/eval 分层、选择器(见 [Library · 读:`openResults`](library.md#读openresults))。
- **身份。** attempt 身份键与去重规则——读写两侧对「同一个 attempt」的理解必须一致,所以住在这。

它不拥有:「看法」(聚合、指标、组件在 [Reports](../reports/README.md))、渲染(view)、执行(runner)。库位于依赖图最底层,不 import core 的任何其它模块;必要时可以原样提成独立 npm 包(给「只想解析或产出 niceeval 结果的工具」用),但先作为子路径导出,不预设。

## 四个消费方

| 消费方 | 用哪面 | 变化 |
|---|---|---|
| runner 的 `Artifacts()` reporter | 写 | 薄壳:订阅 reporter 事件,按 experimentId 路由到对应快照 writer |
| `niceeval view` | 读 | 旧 `readSummary` / `loadSummaries` 删掉,`src/view/data.ts` 吃 reader,版本判定与 skipped 姿势统一 |
| [Reports](../reports/README.md) 的计算函数 | 读 | 第二档的全部数据入口 |
| 你的脚本 / 第三方工具 | 读、写、发布 | 读:自定义分析;写:把别家平台的结果转成 niceeval 格式,`niceeval view` 直接能看;发布:`copySnapshots` 瘦身快照进仓库 / CDN——兼容性都由库保证,不用抄格式文档 |

## 相关阅读

- [Library](library.md) —— `niceeval/results` 的 TS 读写 API。
- [Architecture](architecture.md) —— 磁盘上的格式规范。
- [Reports](../reports/README.md) —— 建立在本库读取面之上的积木:指标、计算函数、React 组件。
- [View](../view/README.md) —— 内置前端;读取层吃本库 reader。
- [Experiments](../experiments/README.md) —— experimentId 与可对比组从哪来。
