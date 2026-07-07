# Reports —— 自己搭报告页的积木(设计提案,未实现)

> 状态:设计提案。本文描述目标 DX 与数据契约,尚无对应实现;`docs/source-map.md` 里没有它的源码入口。它脚下的数据层——结果的读与写——是一个专门的库,拆在 [Results Lib](results-lib.md)。

跑完一轮实验之后,「怎么看结果」不该只有 `niceeval view` 那三个固定 tab。你想把同一批结果摆成一张**考试成绩单**(每个 eval 是一道题,gate 判对错、soft 给分、按科目算总分),摆成一张 **benchmark 榜**(谁写出来的代码能用、谁写得更短、谁更便宜),或者摆成一张**质量 × 成本 frontier**(每个配置一个点,同 agent 不同档位连成线,右上角 = 又好又便宜)——这三种「看法」用的是同一份落盘工件,差别只在组合方式。

今天做不到:落盘工件虽然结构化,但没有读取契约,想算个自定义指标只能手工爬目录(那段痛苦的样子见 [Results Lib](results-lib.md) 开头);就算读到了,分组、聚合、null 处理、画图仍是全套手写。

本提案只给**两档积木**,没有中间格式:

```text
 第二档:数据(niceeval/results 读 + niceeval/report 算)  第一档:React 组件(niceeval/report/react,跑在哪都行)
 ---------------------------------------------------    --------------------------------------------------
 .niceeval/<run>/… ──openResults──▶ snapshots       <MetricTable/> <MetricScatter/> <DeltaTable/> …共七个
 defineMetric × Dimension                      ──▶  props = 算好的可序列化数据(终值 + 渲染提示)
 table()/scatter()/delta()/cases()… 折出终值         (排序、覆盖率角标、连线、点格子下钻)
 (两级聚合、null 语义、去重全在这侧)
```

- **第一档:React 组件。** 报告页就是你应用里的一页:import 组件,像搭积木一样拼 JSX。组件只认「算好的可序列化数据」,零 IO、可进 `"use client"`,所以 RSC、Vite SPA、静态导出都能用。
- **第二档:parser 与强定义。** `openResults`(来自结果读写库 [Results Lib](results-lib.md) 的读取面)把落盘工件变成类型化句柄;`defineMetric` 加计算函数把句柄折成组件要的数据。组件表达不了的看法,直接拿句柄自己算。

两档之间是一条**可序列化边界**:算与画分离,数据是普通 JSON——可以在 RSC 里当场 `await`,也可以在 CI 里落成 `public/report.json` 喂给任何 SPA。**import 边界即运行时边界**:`niceeval/results` 与 `niceeval/report` 的计算函数碰文件系统,只能进服务端/脚本;`niceeval/report/react` 纯渲染。可达百 MB 的 diff 永远不该在渲染路径上被读,这条边界就是为它划的。

> 与早先草案的差异:第一版有 `defineReport` + `reports/` 目录 + `ReportDoc` 文件格式 + `niceeval report` CLI,现已全部砍掉。报告页的宿主永远是用户自己的应用,为它发明「配置文件 → 文档格式 → 渲染 CLI」三层中转,每层都是学习成本,表达力反而不如 JSX(说明文字曾需要一个 `markdown()` 块——在 JSX 里那就是一行 `<p>`)。零代码看结果的需求归 `niceeval view`;本提案只服务「要自己的页面」的用户。

## 与现有件的关系

| 件 | 时机 | 职责 |
|---|---|---|
| **Reporter**(`Console()` / `Artifacts()` / `JUnit()`…) | 运行**中**,流式回调 | 把结果送出去:打控制台、落盘、上报平台 |
| **Results Format**(`.niceeval/<run>/`) | 运行**后**,静态工件 | 唯一持久化事实来源([Results Format](results-format.md)) |
| **Results Lib**([提案](results-lib.md)) | 运行中写,运行后读 | 结果数据的专门库:类型的家 + writer(`Artifacts()` 的落盘实现)+ reader(类型化句柄/快照/选择器)。本提案的第二档吃它的读取面 |
| **Report(本提案)** | 运行后,按需 | 指标 × 计算函数 × React 组件,把落盘工件组合成**你自己应用里的报告页** |
| **`niceeval view`** | 运行后,按需 | 内置前端,零代码的通用看法——合流后就是「官方积木搭的默认报告页 + 证据室」,路线见 [View · 用 Reports 积木重建 view](view.md#用-reports-积木重建-view设计提案) |

Report 不新增任何落盘事实——它只消费 Results Format 已有的东西。反过来这也是设计约束:**一个指标能不能算,取决于工件里有没有对应数据**;工件缺了(比如 remote agent 没有 `diff.json`),指标对该 attempt 返回 `null`,聚合时跳过,不编数。

> 命名说明:runtime 回调通道叫 **Reporter**,本提案的包叫 `niceeval/report`。砍掉 `reports/` 目录与 CLI 后,两词同屏的场合只剩 import 语句,混淆面已小;文档里仍永远用全名,不缩写成"报告器/报告"混用。

## 第一档:React 组件 —— 报告页是你应用里的一页

先看完整的一页(Next.js RSC;不用 Next 的姿势见 [DX 模拟](#dx-模拟)场景二):

```tsx
// app/evals/page.tsx —— code-golf:谁写出能用的代码,谁写得短,谁便宜
import { openResults, latestPerExperiment } from "niceeval/results";
import { defineMetric, overview, table, matrix, scatter, passRate, costUSD, durationMs } from "niceeval/report";
import { RunOverview, MetricTable, MetricMatrix, MetricScatter } from "niceeval/report/react";

const codeLines = defineMetric({
  name: "code-lines",
  label: "代码行数",
  better: "lower",
  unit: "lines",
  where: (a) => a.result.outcome === "passed",   // 只比能用的代码(见「指标与聚合」)
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;
    return Object.values(diff.generatedFiles)
      .reduce((n, src) => n + src.split("\n").length, 0);
  },
});

export default async function EvalsPage() {
  const results = await openResults(".niceeval");
  const { snapshots, warnings } = latestPerExperiment(results.snapshots, { experiments: "compare/" });

  return (
    <main>
      <h1>Code Golf:能用 × 短 × 便宜</h1>
      <RunOverview data={await overview(snapshots, { warnings })} />
      {/* 页头 KPI 条:何时跑的、几个配置、几道题、总成本;残缺快照的警告直接显示在条内 */}
      <MetricScatter data={await scatter(snapshots, {
        points: "experiment",       // 每个点 = 一个配置的聚合
        series: "agent",            // 同 agent 的点连线(不同 reasoningEffort 档位)
        x: costUSD,
        y: passRate,
      })} />
      <MetricTable data={await table(snapshots, {
        rows: "agent",
        columns: [passRate, codeLines, costUSD, durationMs],
        sort: passRate,
      })} />
      <MetricMatrix
        data={await matrix(snapshots, { rows: "eval", columns: "agent", cell: passRate })}
        attemptHref={(ref) => `/attempts/${ref.run}/${ref.result}`}   // 点格子 → 你自己的下钻页
      />
    </main>
  );
}
```

换一种看法 = 换积木摆法,数据源一个字不动:把 `table` 换成 `scoreboard`、`cell` 从 `passRate` 换成 `examScore`,同一批工件就从 benchmark 榜变成考试成绩单(场景二)。说明文字、布局、品牌色都是你页面里的普通 JSX——这正是第一版 `markdown()` 块被砍的原因。

首批七个组件。边界不是抽象的「刻意少」,而是**让第一个真实消费者的报告页完整成立**:场景三里 coding-agent-memory-evals 的线上报告要回答「记忆开关值不值」,这七个缺一个都拼不完整,多的暂时都不加:

```typescript
// niceeval/report/react —— 纯渲染,零 IO,可进 "use client"
function RunOverview(props: { data: OverviewData; className?: string }): JSX.Element;
        // 页头 KPI 条:何时跑的、几个配置、几道题、通过率、总成本 —— 每张报告页的「这批数据是什么」

function MetricTable(props: {
  data: TableData;
  attemptHref?: (ref: AttemptRef) => string;  // 传了,格子可点、下钻去处你定;不传,纯展示
  className?: string;
}): JSX.Element;

function MetricMatrix(props: {
  data: MatrixData;
  attemptHref?: (ref: AttemptRef) => string;
  className?: string;
}): JSX.Element;

function Scoreboard(props: { data: ScoreboardData; className?: string }): JSX.Element;

function MetricScatter(props: {
  data: ScatterData;
  pointHref?: (row: ScatterData["rows"][number]) => string;   // 点一个点 → 该配置的下钻页
  className?: string;
}): JSX.Element;

function DeltaTable(props: {
  data: DeltaData;                            // 成对对比:B 相对 A 每个指标的 Δ,涨跌配色随 better
  className?: string;
}): JSX.Element;

function CaseList(props: {
  data: CaseListData;                         // 失败案例清单:报告回答完「多少」,这里回答「为什么」
  attemptHref?: (ref: AttemptRef) => string;
  className?: string;
}): JSX.Element;
```

组件内置的行为全是纯展示逻辑:

- **RunOverview**:通过率、成本、耗时这排数字下面标注数据来源(几个快照、何时跑的);`warnings` 有内容时直接显示在条内——诚实不靠使用者记得渲染。
- **MetricTable**:列头可点重排,方向随指标的 `better`(higher 降序、lower 升序,「好」的一头在上);`samples < total` 的格子带覆盖率角标;一组全 `null` 渲染成「缺数据」,绝不画 0。
- **MetricMatrix**:稀疏渲染(没有样本的格子空着);`cell.refs` + `attemptHref` 让「哪道题谁挂了,一眼看穿」之后的下一步——「给我看那次 attempt」——就在手边。
- **Scoreboard**:总分 + 分科小计,`missing`(没跑、按 0 计的题数)如实展示在科目行,固定分母的口径不藏。
- **MetricScatter**:轴向随 `better`——`lower` 的轴反向画,「好」的角落恒在右上(成本轴 $20 → $0 就是这么来的);同系列的点按 x 排序连线,系列名标在线旁;x 或 y 为 `null` 的点不画,底部注脚如实报「n 个点缺数据」;hover 显示 `display` 与 `samples/total`。
- **DeltaTable**:每行一对配置(如「bub:裸 vs +AGENTS.md」),每列一个指标,格子里 A、B、Δ 三个值;Δ 的涨跌好坏由 `better` 判定,任一侧缺数据时 Δ 显示为缺,不硬算。
- **CaseList**:失败与出错的 attempt 逐条列出——失败断言、error 摘要、judge 评语(`evidence`),每条带 `attemptHref` 下钻;`truncated` 如实报「还有 n 条没列」。

四条跨组件的契约保证:

- **不 hydrate 也完整。** 每个组件在 `renderToStaticMarkup` 下必须产出完整可读的 HTML:排序靠计算时的 `sort` 预排,hover 信息退化为 `title`,下钻是普通 `<a>`。客户端交互(点列头重排、展开折叠)全部是渐进增强——静态导出是一等公民,不是降级模式(场景三)。
- **跨块配色一致。** 系列/维度键到调色板的映射是稳定散列:同一个 agent 在 scatter 的线、DeltaTable 的行、matrix 的列头永远同色,不需要 Provider 或手工配置。
- **样式随包发布。** `niceeval/report/react/styles.css` 一并发布:`nre-*` 稳定类名 + 这一份 CSS,静态页零依赖成立;要定制就在它之后加载自己的覆盖。
- **组件不做数据操作。** 过滤、重新聚合、换口径都是计算侧的事(改参数重算);组件只有展示态交互。想在页面上「只看某个 agent」,就多算几份数据条件渲染,不给组件加过滤器。

## 第二档:结果库的读取面(契约在 Results Lib)

结果数据的读与写抽成了专门的库 `niceeval/results`,完整契约在 [Results Lib](results-lib.md);本提案只消费它的读取面,这里备忘入口:`openResults(".niceeval")` 给出 `runs`(忠实磁盘)/ `snapshots`(experiment × run 切片,选择与聚合的单元)/ `skipped`(读不了的 run,不静默);attempt 级重工件(`events` / `trace` / `o11y` / `diff` / `sources`)全部懒加载,缺了返回 `null`;`latestPerExperiment(snapshots)` 返回 `{ snapshots, warnings }`,残缺快照的警告替你算好。本文其余部分都建立在这些句柄之上。

## 指标与聚合:「算什么」的积木

### Metric —— 一个 attempt 算出一个值

指标是纯函数:吃一个 `AttemptHandle`,吐一个值(或 `null` 表示「此 attempt 测不了这个指标」),外加名字、两级聚合方式和渲染提示。

```typescript
import { defineMetric } from "niceeval/report";

// 自定义指标:生成代码总行数(code-golf 的「谁短」)
const codeLines = defineMetric({
  name: "code-lines",                 // MetricColumn.key 与列头的来源;同一次计算里重名是错误
  label: "代码行数",                   // 列头;省略时用 name
  description: "通过的 attempt 的生成代码总行数",
  better: "lower",                    // 渲染提示:越低越好(排序方向、轴向、涨跌配色用)
  unit: "lines",
  where: (a) => a.result.outcome === "passed",  // 不满足 → null。少这行,榜单会奖励「写得短的坏代码」
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;           // 没有 diff 的 attempt 不计入,不记 0
    return Object.values(diff.generatedFiles)
      .reduce((n, src) => n + src.split("\n").length, 0);
  },
  aggregate: { perEval: "mean", across: "mean" },   // 两级聚合(见下节);这就是默认值,可省略
});
```

`where` 只是把「先看 outcome 再计值」变成声明,语义等价于在 `value` 开头 return null。单独设字段,是因为这一步最容易忘:code-golf 的本意是「**能用** × 短」,忘了它,写了半个函数就崩掉的 agent 会赢下「最短代码」。

内置指标与自定义指标是**同一个类型**,没有特权:

```typescript
import { passRate, durationMs, tokens, costUSD, examScore } from "niceeval/report";
```

### 聚合是两级的:attempt → 题,题 → 组

「每格 attempt 数相等」是幻觉:`earlyExit` 默认开——过了就停,errored 也停,只有 failed 会跑满 `runs`([Runner](runner.md))。失败的题天然比通过的题样本多。把组里所有 attempt 平铺求均值,分数就和重试策略纠缠在一起:

```text
eval A 首次即过 → 样本 [1]        eval B 三连挂 → 样本 [0, 0, 0]
平铺 mean = 1/4 = 0.25            题内先折、再跨题平均 = (1 + 0)/2 = 0.5
```

0.5 回答「这套题它做对几成」;0.25 是重试策略的伪影,改一下 `earlyExit` 或 `runs` 数字就变。所以聚合钉成两级,默认宏平均:

```typescript
type Aggregator = "mean" | "sum" | "min" | "max" | ((values: number[]) => number);

interface MetricAggregate {
  perEval?: Aggregator;   // 第一级:同一 (eval × 快照) 的多 attempt → 一个题级值,默认 "mean"
  across?: Aggregator;    // 第二级:分组内的题级值 → 格子终值,默认 "mean"
}
```

「k 次里最好一次」因此不是特例,就是一次普通组合:

```typescript
const passAtK = defineMetric({
  name: "pass@k",
  description: "k 次尝试里至少通过一次的题占比",
  better: "higher",
  unit: "%",
  value: (a) =>
    a.result.outcome === "skipped" ? null : a.result.outcome === "passed" ? 1 : 0,
  aggregate: { perEval: "max", across: "mean" },   // 题内取最好一次,跨题取占比
});
```

自定义维度把同一道题的 attempt 分进不同组时,第一级折叠发生在各组内部。

### null 不是 0:每个指标对四个 outcome 表态

`null` = 「此 attempt 测不了这个指标」,不进聚合;`0` = 「测了,结果是零」,照常进。哪个 outcome 落哪边必须由指标作者显式决定,内置指标先表态:

| 内置指标(name) | skipped | errored | failed | passed | better |
|---|---|---|---|---|---|
| `passRate`(`pass-rate`) | null | 0 | 0 | 1 | higher |
| `examScore`(`exam-score`) | null | 0 | 0 | soft 均分(无 soft 则 1) | higher |
| `durationMs`(`duration`) | null | 实测 | 实测 | 实测 | lower |
| `tokens`(`tokens`) | null | 实测;无 usage 则 null | 同左 | 同左 | lower |
| `costUSD`(`cost`) | null | 同上 | 同左 | 同左 | lower |

(默认聚合全部是 `mean / mean`。)两个容易搞反的点:

- **examScore 先按 outcome 分派,再看断言。** errored 的 attempt 断言是空数组——只按「gate 全过才得分」的字面实现,空数组会让条件空真成立,崩溃反而得满分。交白卷是 0 分:不是缺数据,更不是满分。
- **报告不重新判卷。** examScore 只认落盘的 `outcome`:`--strict` 下被翻成 failed 的 attempt 得 0,哪怕它的 soft 分不低。判决口径与 run 时一致;想换口径去改 run,不在报告里另起炉灶。

`examScore` 仍是「考试」看法的核心积木:gate 是判卷线,soft 是给分点——这套语义 [Scoring](scoring.md) 里本来就有,指标只是把它折成一个数。`tokens` 只加 `inputTokens + outputTokens`:缓存读写量大但便宜,计进去会把缓存热的 agent 画成 token 大户;花钱多少本来就有 `costUSD` 负责。

显示格式由 `unit` 驱动内置格式化(`"%"` → `87%`、`"ms"` → `1.2s`、`"$"` → `$0.31`、其余 → `1.2k lines` 式缩写);要更细的控制,给 metric 传 `display?: (value: number) => string`。

### Dimension —— attempt 分到哪一组

维度决定表格的行(或矩阵的行列、散点的点)。内置维度就是 `EvalResult` 已有的身份字段;自定义维度是一个函数:

```typescript
type Dimension =
  | "agent" | "model" | "experiment" | "eval" | "evalGroup" | "snapshot"
  | { name: string; of: (attempt: AttemptHandle) => string };

// "evalGroup" = eval id 的第一段:"algebra/quadratic" → "algebra"(考试里的「科目」)
// "snapshot"  = "<experimentId> @ <startedAt>",把两次快照并排成行,与 view 的 Compare 同口径
```

## 计算函数与数据契约

`table` / `matrix` / `scoreboard` / `scatter` / `overview` / `delta` / `cases` 是「快照 → 一份组件数据」的计算函数,跑在 Node 侧,产物是**算好的、可序列化的**普通 JSON——终值加渲染提示,不含公式。这与 `niceeval view`「一次性烘焙进静态产物」的哲学一致([View](view.md)):前端(不管是不是我们的组件)只做渲染。

```typescript
import { table, matrix, scoreboard, scatter } from "niceeval/report";

await table(snapshots, {
  rows: "agent",                      // 行维度
  columns: [passRate, codeLines],     // 每列一个指标
  sort: passRate,                     // 构建时排序,方向随 better;组件里还能点列头重排
  evals: "algebra/",                  // 可选:eval id 前缀过滤,同 CLI 语义
});                                   // → TableData

await matrix(snapshots, { rows: "eval", columns: "agent", cell: examScore });  // → MatrixData

await scoreboard(snapshots, {
  of: "agent",                        // 给谁打分
  subjects: "evalGroup",              // 按什么分科
  weights: { "algebra/": 2 },         // eval id 前缀 → 每题分值;未列默认 1;前缀重叠时最长的生效
  fullMarks: 100,                     // 折算满分
  score: examScore,                   // 每题得分指标;缺省即 examScore,可换自定义(如「答对但超预算扣分」)
});                                   // → ScoreboardData

await scatter(snapshots, {
  points: "experiment",               // 点维度:每个点 = 该组 attempt 的聚合
  series: "agent",                    // 可选:同系列的点连成线;省略 = 纯散点
  x: costUSD,                         // 两个指标各占一轴,走同一台两级聚合引擎
  y: passRate,
});                                   // → ScatterData

await overview(snapshots, { warnings });   // → OverviewData:页头 KPI + 数据来源 + 警告透传

await delta(snapshots, {
  pairs: [                            // 每行一对:B 相对 A
    { a: "compare/bub-gpt-5.4", b: "compare/bub-gpt-5.4--agents-md", label: "bub" },
    { a: "compare/codex-gpt-5.4", b: "compare/codex-gpt-5.4--agents-md", label: "codex" },
  ],
  metrics: [passRate, costUSD, durationMs],
});                                   // → DeltaData

await cases(snapshots, {
  outcomes: ["failed", "errored"],    // 默认就是这两类
  limit: 20,                          // 超出如实报 truncated,不静默截断
  redact: (s) => s.replaceAll(repoRoot, ""),   // 自由文本(error / 断言 detail / judge evidence)的发布消毒钩子
});                                   // → CaseListData
```

**scatter 就是「质量 × 成本 frontier」的积木**:[Experiments](experiments.md) 的一文件一配置意味着 `compare/bub-low`、`compare/bub-medium`、`compare/bub-high` 各是一个实验——`points: "experiment"` 让每个档位成为一个点,`series: "agent"` 把同 agent 的档位连成线,`better` 驱动的轴向让右上角恒为「又好又便宜」。点的 x/y 就是两个 `MetricCell`:按点维度分组后走同一台两级聚合引擎,所以 `samples` / `total` / `refs` 一应俱全,hover 与下钻不用另做一套。

**scoreboard 的公式是逐题分值制,分母对所有被打分者恒定:**

```text
题分值 = 命中的权重(默认 1)       题得分 = score 指标的题级值(perEval 折叠后)
总分   = fullMarks × Σ(题得分 × 题分值) / Σ(题分值)      Σ 遍历选中范围内全部题
```

某个 agent 没跑到的题挣 0 分,但**留在分母里**,科目小计里如实报 `missing` 数。分母若随人变,总分就没有可比性——这不违反「缺数据不补 0」:考试的契约本来就是「没答不得分」,诚实体现在把 missing 摆出来,而不是给每个人各配一张满分不同的卷子。科目题多分就多,与真实考卷一致;要「科目等权」,给轻科目的题配大权重即可。

数据契约(即组件的 props 类型,从 `niceeval/report` 导出):

```typescript
interface TableData {
  dimension: string;                  // 行维度名,如 "agent"
  columns: MetricColumn[];
  rows: { key: string; cells: Record<string, MetricCell> }[];
}

interface MatrixData {
  rows: string;                       // 行维度名,如 "eval"
  columns: string;                    // 列维度名,如 "agent"
  metric: MetricColumn;
  cells: { row: string; column: string; cell: MetricCell }[];   // 稀疏:没有样本的格子不出现
}

interface ScoreboardData {
  of: string;                         // 被打分的维度名,如 "agent"
  fullMarks: number;
  weights: { prefix: string; weight: number }[];   // 实际生效的权重表 —— 成绩单可审计
  rows: {
    key: string;
    total: { value: number; display: string };     // 已折算到 fullMarks
    subjects: {
      key: string;                    // 科目(subjects 维度的值)
      earned: number;                 // 加权得分
      possible: number;               // 科目分值合计
      evals: number;                  // 题数
      missing: number;                // 无任何样本、按 0 计的题数 —— 固定分母的如实注脚
    }[];
  }[];
}

interface ScatterData {
  points: string;                     // 点维度名,如 "experiment"
  series?: string;                    // 系列维度名,如 "agent"
  x: MetricColumn;                    // better: "lower" → 组件反向画轴,「好」的角落恒在右上
  y: MetricColumn;
  rows: {
    key: string;                      // 点的键,如 "compare/bub-high"
    series?: string;                  // 所属系列,如 "bub"
    x: MetricCell;
    y: MetricCell;                    // 任一为 null 的点组件不画,注脚如实报数
  }[];
}

interface OverviewData {
  snapshots: { experimentId: string; agent: string; model?: string; startedAt: string }[];
  totals: {
    evals: number; attempts: number;
    passed: number; failed: number; errored: number; skipped: number;
    costUSD: number | null;           // 任一 attempt 报了成本才有;全缺 = null,不编 0
    durationMs: number;
  };
  warnings: string[];                 // 选择器的警告透传进来,RunOverview 直接渲染
}

interface DeltaData {
  columns: MetricColumn[];
  rows: {
    key: string;                      // pair 的 label,如 "bub"
    a: { experimentId: string };      // 基线侧
    b: { experimentId: string };      // 对比侧
    cells: Record<string, {
      a: MetricCell;
      b: MetricCell;
      delta: number | null;           // b.value - a.value;任一侧 null → null,不硬算
      display: string;                // 已带符号("+12%" / "-$0.8"),涨跌好坏由 better 判定
    }>;
  }[];
}

interface CaseListData {
  rows: {
    eval: string;
    experimentId: string;
    agent: string;
    outcome: "failed" | "errored";
    error?: string;                   // errored 的错误摘要(已过 redact)
    failedAssertions: { name: string; score: number; detail?: string; evidence?: string }[];
    durationMs: number;
    costUSD?: number;
    ref: AttemptRef;                  // 每条案例都能回到证据
  }[];
  truncated: number;                  // limit 之外还有几条,如实报
}

interface MetricColumn {
  key: string;                        // = metric.name,与 cells 的键对应
  label: string;
  unit?: string;
  better?: "higher" | "lower";        // 渲染提示:排序方向、轴向、涨跌配色
}

interface MetricCell {
  value: number | null;               // 聚合后的值;null = 该组没有任何有效样本
  display: string;                    // 已格式化("87%" / "1.2k lines" / "$0.31"),前端可直接渲染
  samples: number;                    // 有效 attempt 数(值为 null 的不计入)
  total: number;                      // 组内 attempt 总数;samples < total = 有 attempt 测不了这个指标
  refs?: AttemptRef[];                // 这个格子由哪些 attempt 算出 —— 回到证据的引用
}

interface AttemptRef {
  run: string;                        // run 目录名(相对结果根目录)
  result: number;                     // 该 run summary.results[] 的下标
}
```

这些**不是持久化格式,只是组件 props**——没有 `format` / `schemaVersion` 信封。要落盘喂 SPA(场景二)就自己包一层 JSON,想加 `generatedAt` 加就是了。兼容性跟随 npm 版本:计算侧和渲染侧本来就是同一个包的两个子路径,同一个应用里天然同版本;唯一要留意的是**分离部署**(CI 脚本算数据、另一个仓库的前端渲染)时把两边锁在同一个 niceeval 版本——要不要为此给数据打轻量版本戳,见文末待定问题。

## DX 模拟

### 场景一:Next.js RSC —— 见[第一档](#第一档react-组件--报告页是你应用里的一页)开头

算与画同页,`await` 就地发生;数据换新 = 重跑 `niceeval exp`,页面刷新即最新。

### 场景二:任意 SPA —— CI 落 JSON,前端 fetch

计算跑在出结果的地方(CI),页面在哪都行(Vite、已有内部面板、无 Node 的静态托管):

```typescript
// scripts/build-report-data.ts —— CI 里 niceeval exp 之后执行
import { writeFile } from "node:fs/promises";
import { openResults, latestPerExperiment } from "niceeval/results";
import { scoreboard, matrix, examScore } from "niceeval/report";

const results = await openResults(".niceeval");
const { snapshots, warnings } = latestPerExperiment(results.snapshots, { experiments: "midterm/" });

await writeFile("public/midterm.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  warnings,
  board: await scoreboard(snapshots, {
    of: "agent", subjects: "evalGroup", weights: { "algebra/": 2 }, fullMarks: 100,
  }),
  byEval: await matrix(snapshots, { rows: "eval", columns: "agent", cell: examScore }),
}));
```

```tsx
// 前端(任何 React 应用)—— 组件纯渲染,client 侧可用
import { Scoreboard, MetricMatrix } from "niceeval/report/react";

const doc = await fetch("/midterm.json").then((r) => r.json());

<Scoreboard data={doc.board} />
<MetricMatrix data={doc.byEval} attemptHref={(ref) => `/attempts/${ref.run}/${ref.result}`} />
```

和场景一是同一批工件、同一套组件,只是可序列化边界从「RSC 内存里」挪到了「一个 JSON 文件」。

### 场景三:零框架静态导出 —— 以 coding-agent-memory-evals 为原型

真实仓库 coding-agent-memory-evals 今天的静态导出是三段式:脚本 A 按 mtime 挑「最新 run」、按白名单手拷工件进 `site/data/run/`(提交进仓库,否则 CI 上没有数据、会悄悄生成空报告);脚本 B 调 `niceeval view --out` 生成通用查看器,再**用字符串标记从生成的 HTML 里扒出内嵌 JSON**、正则消毒构建机路径、塞回去;Vercel 静态托管 `site/`。三处都在重新发明布局知识——而且页面只能是 view 的三个通用 tab,这套件真正要回答的「记忆开关值不值」根本摆不出来。

重构后,整条流水线是「读 → 算 → `renderToStaticMarkup`」,不需要任何前端框架:

```tsx
// scripts/snapshot.ts —— 跑完 eval 在本机执行:把最新快照瘦身提交进仓库
// (沿用该仓库的铁律:线上构建只吃提交的数据,CI 上没有 .niceeval,绝不悄悄出空报告)
import { openResults, latestPerExperiment, copyRun } from "niceeval/results";

const local = await openResults(".niceeval");
const picked = latestPerExperiment(local.snapshots, { experiments: "compare/" });
await copyRun(picked.snapshots, "site/data/run", { artifacts: ["sources", "events", "trace"] });
```

```tsx
// scripts/build-site.tsx —— tsx 直跑;报告页是纯函数,从提交的快照静态渲染一次成型
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { openResults, latestPerExperiment } from "niceeval/results";
import { overview, delta, scatter, matrix, cases, passRate, costUSD, durationMs } from "niceeval/report";
import { RunOverview, DeltaTable, MetricScatter, MetricMatrix, CaseList } from "niceeval/report/react";

const results = await openResults("site/data/run");
const { snapshots, warnings } = latestPerExperiment(results.snapshots);

const PAIRS = ["bub-gpt-5.4", "codex-gpt-5.4", "claude-dp-v4"].map((c) => ({
  a: `compare/${c}`, b: `compare/${c}--agents-md`, label: c,
}));
const attemptHref = (ref) => `view/#/attempt/${ref.run}/${ref.result}`;   // 证据室:同站托管的 view

const page = renderToStaticMarkup(
  <main>
    <h1>Memory 开关值不值</h1>
    <RunOverview data={await overview(snapshots, { warnings })} />
    <DeltaTable data={await delta(snapshots, { pairs: PAIRS, metrics: [passRate, costUSD, durationMs] })} />
    <MetricScatter data={await scatter(snapshots, { points: "experiment", series: "agent", x: costUSD, y: passRate })} />
    <MetricMatrix data={await matrix(snapshots, { rows: "eval", columns: "experiment", cell: passRate })} attemptHref={attemptHref} />
    <CaseList data={await cases(snapshots, { limit: 20 })} attemptHref={attemptHref} />
  </main>,
);
writeFileSync("site/index.html", `<!doctype html><link rel="stylesheet" href="styles.css">${page}`);

// 证据室:transcript / 代码视图 / trace 仍归 view —— 目录导出放子路径,报告页深链进去
// `niceeval view --out site/view site/data/run`(现有 CLI,脚本里 execFile 即可)
```

分工:**报告页是前门**(这套件自己的问题、自己的摆法),**view 是证据室**(attempt 级 transcript / 代码 / trace)。`copyRun` 是结果库的发布原语([Results Lib](results-lib.md#复制与瘦身copyrun)),取代手写的 mtime 挑选 + 白名单拷贝;「最新 run 可能残缺」的坑由选择器算出警告、`RunOverview` 直接展示;构建机路径消毒收进 `cases` 的 `redact` 钩子。原来两个脚本里所有「懂格式」的代码,一行都不剩。

### 场景四:深接入 —— 组件表达不了的,拿句柄自己算

分布类的看法(直方图)不是折叠,计算函数给不了;直接下到结果库的读取面,示例见 [Results Lib · 直接吃读取面](results-lib.md#直接吃读取面一个真实脚本)。

## 边界与不变量

- **core 中立不破。** 指标函数是用户代码,想读什么工件读什么;但计算函数与组件只认 `Metric` / `Dimension` 接口,不出现 `agent === "codex"` 这类分支。「考试」「benchmark」「frontier」都不是 core 概念,只是积木摆法。
- **Report 不写事实。** 唯一事实来源仍是 Results Format;组件数据是派生物,删了随时可重算,因此不需要迁移机制。
- **null ≠ 0。** `null` = 此 attempt 测不了这个指标,不进聚合;`0` = 测了,结果是零,照常进。每个指标(含内置)对四个 outcome 逐一表态;`MetricCell` 用 `samples` / `total` 如实报覆盖率,一组全 `null` 渲染成缺数据,绝不补 0(与[成本设计](observability.md#换算成本价格表从哪来)「未知模型不瞎猜」同一原则)。scoreboard 的固定分母是显式的考试契约、不是这条的例外:没答的题 0 分挣,`missing` 如实报。
- **报告不重新判卷。** 指标只消费落盘的 `outcome` 与断言,不推翻 run 时的判决口径;换口径的正确位置是重跑,不是报告。
- **选择诚实。** 残缺快照、被跳过的 run、发生过的去重,全部以 `warnings` / `skipped` 返回给调用方,不静默;组件对 `samples < total`、全 `null` 的格子和缺数据的点如实渲染。
- **跨快照聚合先去重。** 计算函数在聚合前按 [Results Lib 的身份键](results-lib.md#身份键与去重)去重——`--resume` 会让同一 attempt 存在于多份落盘,细节与键的定义见那边。
- **快照身份保留在结果库。** 合并与聚合永远发生在计算函数里,可被用户的选择与聚合配置覆盖。

## 待定的 DX 问题(迭代入口)

1. **时间轴 delta。** 成对 delta(`DeltaTable`)进了首批,但它比的是「两个配置」;「这次 vs 上次」(同一配置两个快照)先用 `"snapshot"` 维度顶着,真正的时间轴对比组件等 view 的 Compare 落地后对齐口径,免得两套「对比」语义分叉。
2. **`refs` 的体积上限。** 设计上完整携带(单格样本数有限),但全历史矩阵可能膨胀;若实测超标再定截断规则(每格上限 + `truncated` 标记),不预设。
3. **组件数据要不要版本戳。** 同应用内计算与渲染同包同版本,没有偏斜;分离部署靠锁版本约束。若真实用户撞上偏斜,再考虑给 `TableData` 等加一个轻量 `producer` 戳,先不加。
4. **样式定制深度。** 首批只承诺稳定 class 名(`nre-*`)+ `className` 透传;要不要 slots / render props(比如自定义格子渲染、scatter 点标签防重叠策略),看第一批用户把组件嵌进真实面板时卡在哪。
5. **view 的 attempt 级深链。** `attemptHref` 最自然的去处是同站托管的 view 导出,但 view 今天没有 attempt 级 hash 路由(AttemptModal 只能从表格点开)。补一条 `#/attempt/<run>/<result>` 路由是 view 侧的小改动,「报告页是前门、view 是证据室」的分工才真正闭环。

## 相关阅读

- [Results Lib](results-lib.md) —— 结果读写库:类型的家、writer、openResults、快照、选择器、身份键。
- [Results Format](results-format.md) —— 唯一持久化事实来源。
- [Runner](runner.md) —— earlyExit 与重试的调度行为:两级聚合的动因。
- [Observability](observability.md) —— usage / cost / o11y 摘要这些指标原料从哪来。
- [View](view.md) —— 内置前端;快照口径、Compare 计划与散点图都与本提案对齐。
- [Experiments](experiments.md) —— 可对比组与 reasoningEffort 档位:scatter 的点从哪来。
- [Scoring](scoring.md) —— gate / soft 断言语义,`examScore` 的依据。
