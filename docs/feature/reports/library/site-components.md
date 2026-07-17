# 站点组件

构成一个「完整报告站」的组件：站点标题区（hero）、品牌行、选择警告区、批量修复 prompt 与 trace 瀑布。它们与指标组件、实体列表在同一工具箱里，没有任何宿主特权——[内建报告](built-in.md)的三页全部由本页组件加 [`ExperimentComparison`](summaries.md#experimentcomparison) / [`AttemptList`](entity-lists.md#attemptlist) 写成，任何用户报告都能逐字复刻或整块丢弃。props 组合规则 `DataProps` 见[指标组件](metric-views.md)。

## `Hero`

页首的站点标题区：标题、最后运行时间、快照合成来源，恒含品牌行。它是官方组合组件（与 [`FailureList`](entity-lists.md#failurelist) 同族的成品，没有私有能力）：标题缺省取 `ctx.report.title`——规范化声明里走完回退链（`def.title` → 唯一快照 `name` → 内置文案）的站点标题，与浏览器标题同源；运行 meta 取自宿主注入的 Scope。内部严格等价于手写组合：

```tsx
const Hero = defineComponent(async ({ title, className }: HeroProps, ctx) => (
  <HeroCard title={title ?? ctx.report.title} data={await heroData(ctx.scope)} className={className} />
));
```

```ts
interface HeroProps {
  /** 覆盖标题；省略时取 ctx.report.title（回退链后的站点标题）。 */
  title?: LocalizedText;
  className?: string;
}
```

```tsx
<Hero />                          // 标题跟随站点声明
<Hero title="Memory Evals" />     // 显式标题
```

读 `ctx.report` 意味着 `Hero` 的输出跟随站点（[契约](shell.md#行为约束)）；要站点无关的标题区，直接用 `HeroCard` 显式传值。

## `HeroCard`

`Hero` 的渲染件，双面组件，只收 data 形态——它的标题输入是站点声明与 Scope 的合成物，没有单独的 spec 等价形，所以不设 spec 形态：

```ts
interface HeroData {
  /** Scope 中最新快照的开始时间；空 Scope 为 null，不编造当前时间。 */
  latestStartedAt: string | null;
  /** 贡献当前水位的快照数；大于 1 时 web 面标注「由 N 次运行合成」。 */
  snapshots: number;
}

function heroData(input: ReportInput): Promise<HeroData>;

interface HeroCardProps {
  title: LocalizedText;
  data: HeroData;
  className?: string;
}
```

web 面渲染 hero 标题（`<h1>`）、meta 行（最后运行时间按渲染 locale 格式化；`latestStartedAt` 为 null 时显示内置「暂无运行」文案）与品牌行（等同 [`PoweredBy`](#poweredby)，恒含、无拆除 prop）；text 面输出标题行与 meta 行，不含品牌行。`niceeval/report/react` 导出同名纯组件，web 行为一致——品牌跟着组件走，不区分官方宿主与嵌入页面。

## `PoweredBy`

唯一的品牌件：无 props 双面组件。web 面渲染指向 niceeval 官网的一行品牌色小字 `Powered by NiceEval`（`https://niceeval.com/?utm_source=report&utm_medium=powered-by`，`rel` 只声明 `noopener` 以保留 Referer）；text 面零输出。它没有任何配置——品牌契约就是「提供一个组件，不给开关」：用 `Hero` / `HeroCard` / `PoweredBy` 就带品牌行，不想要品牌就不用这些组件、自己写双面组件替代。自定义 hero 想单独摆品牌行时直接放 `<PoweredBy />`。

```tsx
<PoweredBy />
```

## `ScopeWarnings`

选择警告区：把 Scope 携带的 [`ScopeWarning[]`](../../results/library.md#警告-kind-全集) 按「下一步动作」聚合渲染。它是警告的唯一呈现组件——宿主不再在报告树外另设警告通道，报告里有没有警告区由报告文件决定；[内建报告](built-in.md)每一页都放它。警告可见性因此是作者义务，与自定义脚本的增强层不变量同一信任模型：省略它的报告，其数字可信度由作者自己负责。

```ts
function scopeWarningsData(input: ReportInput): Promise<readonly ScopeWarning[]>;

type ScopeWarningsProps = DataProps<readonly ScopeWarning[], {}, {
  locale?: ReportLocale;
  className?: string;
}>;
```

### 聚合轴是动作，不是发生顺序

实验作用域的多种 kind 天然指向同一条推进命令（重跑该实验）——同一个实验完全可能同时触发覆盖缺口、过旧与未收尾三条警告，而用户要做的事只有一件。逐条平铺会把一件事写成三条长句加三个重复命令，组件按「用户要做什么」组织：

- 带 `experimentId` 的警告按实验聚合成组：组头 = 实验 id + 每条警告一枚徽标（文案取 kind 表登记的徽标模板，按渲染 locale 取词）+ 组内去重后的可复制 `command`。
- 非实验作用域的警告按 kind 聚合成组：组头 = kind 表登记的组头文案（含条数）+ 去重后的命令。
- 组内命令去重后仍多于一条时，组头不放命令、命令随明细逐条走——组头命令的含义永远是「复制即推进整组」，不摆一排让用户猜。
- kind 表未登记模板的 kind（前向兼容）各自单独成组、逐条渲染 `message` 原样，行为不劣于平铺；排序按 `integrity` 归位。
- 组按 kind 表登记的类别排序：`integrity`（选中集合的分母可能不对）在前，`freshness`（数字对但可能过期）在后；一组混合两类时按最重成员归位。

### 摘要恒可见，明细可折叠

信任模型要求的是「警告的存在、分类与下一步和数字同框」，不是「警告全文永远展开」：

- 组数大于 1 时容器首行渲染分类计数的汇总行（如「2 个实验的数字带警告 · 1 个快照被跳过」）；单组时组头即汇总，不另起一行。汇总行与组头永不折叠。
- 每组的逐条原始 `message`（[三段式](../../../error-feedback.md#消息三段式)，已含下一步）是明细层，web 面收进原生 `<details>`——无 JS 可展开，满足增强层「初始静态 HTML 无 JS 完整可读」的不变量；警告总条数 ≤ 3 时默认展开。`message` 是完整叙述的单源，组件只组织、不改写。
- 折叠阈值是行为契约，不设 props 开关（与 `PoweredBy`「提供组件、不给开关」同一哲学）。

### 两面与输入

- text 面同构但不折叠：多组时首行汇总，每组一行组头（标题、徽标、命令），其下缩进逐条原样打印 `message`、不截断掉尾段——终端天然可滚动，截断只会害调试。
- web 面把组头与明细中带 `command` 的警告渲染为可复制命令；无 `command` 的只显示 message，不硬造动作。
- spec 形态 `<ScopeWarnings />` 取宿主注入 Scope 的 `warnings`；`input` 是裸 `Snapshot[]` 时没有挑选过程、没有警告，渲染为空，也如实。
- 空警告集两面零输出，不渲染空容器。
- 嵌入自有 React 页面时用 data 形态：`<ScopeWarnings data={scope.warnings} />`。

```tsx
<ScopeWarnings />
```

## `CopyFixPrompt`

把当前范围的全部失败（verdict 为 `failed` / `errored` 的 attempt）整理成一段可交给 coding agent 的修复 prompt。prompt 文本在 resolve 阶段算好、烘进静态 HTML；「复制到剪贴板」是增强层行为，无 JS 时 prompt 文本在折叠块里完整可读——增强只加浏览行为，不改内容。

```ts
interface CopyFixPromptData {
  /** 修复 prompt 全文；失败逐条含 eval id、主失败摘要与 attempt 下钻命令。 */
  prompt: string;
  /** 参与 prompt 的失败 attempt 数。 */
  failures: number;
}

function copyFixPromptData(input: ReportInput): Promise<CopyFixPromptData>;

type CopyFixPromptProps = DataProps<CopyFixPromptData, {}, {
  locale?: ReportLocale;
  className?: string;
}>;
```

`failures` 为 0 时两面零输出。text 面零输出——终端里的等价能力是 `show` 的 attempt 下钻命令本身，不打印整段 prompt。

```tsx
<CopyFixPrompt />
```

## `TraceWaterfall`

每个 attempt 一行的执行时间瀑布，用 canonical OTel 字段显示被测 agent 的原始 span（agent / model / tool）。行内只画顶层 span 摘要；完整瀑布与 runner 时间树的组合视图归 attempt 详情（宿主路由），组件不复制它。

```ts
interface TraceSpanSummary {
  name: string;
  kind: "agent" | "model" | "tool" | "other";
  startOffsetMs: number;
  durationMs: number;
  failed: boolean;
}

interface TraceWaterfallRow {
  experimentId: string;
  evalId: string;
  locator: AttemptLocator;
  /** trace.json 缺失或为空时 null；行照常出现，证据位置如实显示缺失，不猜值。 */
  durationMs: number | null;
  /** 顶层 span 摘要，按 startOffsetMs 升序。 */
  spans: readonly TraceSpanSummary[];
}

function traceWaterfallData(input: ReportInput): Promise<readonly TraceWaterfallRow[]>;

type TraceWaterfallProps = DataProps<readonly TraceWaterfallRow[], {}, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

- web 面：一行一个 attempt，静态渲染顶层 span 分解条（失败 span 带失败标记），行链接到 attempt 详情；排序、缩放是渐进增强。
- text 面：一行一个 attempt——locator、总耗时、span 计数与失败标记，行尾给出可复制的 `niceeval show @<locator> --timing` 下钻命令。attempt 有选择器，所以 text 面折成带命令的索引是成立的（同[组索引与页索引的规则](../architecture.md#text-面的省略规则)），不倾倒逐 span 明细。
- 只画被测 agent 的原始 span；runner 生命周期节点不进 trace 事实（[Architecture · 事实与看法](../architecture.md#事实与看法)），组合视图归 attempt 详情。

```tsx
<TraceWaterfall />
```

## 相关阅读

- [内建报告](built-in.md) —— 这些组件组成默认站点的样子。
- [外壳与多页](shell.md) —— `ctx.report.title` 的回退链与品牌契约。
- [实体列表](entity-lists.md) —— Attempts 页的本体 `AttemptList`。
- [View](../view.md) —— attempt 详情路由与导航机器。
- [Results Library](../../results/library.md#警告-kind-全集) —— `ScopeWarning` 的 kind 全集。
