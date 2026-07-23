# `--json`：任何视图的结构化形态

`--json` 是 show 的第二个输出形态：同一范围、同一切片选出的同一批实体，输出成一个 JSON 文档到 stdout。text 面与 `--json` 消费同一套选择、去重与聚合规则；两面共有的派生字段必须同值。JSON 是结构化审计面，可以保留 text 为注意力预算省略的字段、完整字符串与完整树，因此它是 text 的数据超集，不承诺两个形态包含完全相同的字段集合。

脚本消费走这里，不翻 `.niceeval/` 原始文件：读取面的选择、去重、时效口径都在 show 里实现过一遍，脚本自己扫目录必然复刻出第二套不一致的口径。需要比 show 视图更自由的读取时用 [`niceeval/results` 库读取面](../../results/library.md)，仍然不直接碰磁盘布局。

## 信封

```typescript
interface ShowJson {
  format: "niceeval.show";
  /** 破坏性形状变更时递增；新增可选字段不递增，消费方忽略未知字段。 */
  schemaVersion: 1;
  view: "leaderboard" | "compare" | "attempt" | "source" | "execution"
      | "timing" | "usage" | "diff" | "history" | "stats";
  /** 本次调用解析后的范围回显。 */
  scope: {
    resultsRoot: string;
    evalPrefix?: string;
    /** 解析后的 experiment id 全集；对照视图下顺序即条件顺序，首个是基准。 */
    experiments: string[];
    fresh: boolean;
  };
  data: unknown; // 逐视图形状见下
}
```

- 输出是**一个**顶层 JSON 文档，不是 NDJSON；stdout 只有这个文档，人读的进度与警告走 stderr。
- 错误路径与 text 面一致：无匹配、用法冲突、零可读结果按同样的判定非零退出，错误信息走 stderr，不输出半个 JSON。
- 字符串值忠实转发落盘内容：终端形态的列宽截断、卡片预览预算**都不适用**；落盘时已被 [256 KiB 上限](../../results/architecture.md#大值截断)截断的值带原样的 `truncated` 标记，`--json` 不追溯还原也不二次截断。

## 逐视图的 `data` 形状

字段名复用 [Results 落盘类型](../../results/architecture.md)，不为 JSON 输出发明第二套命名；派生量（通过率、`uncachedInputTokens`、delta）是显式命名字段，与落盘事实可区分。

```typescript
/** attempt 的通用投影：AttemptRecord 全字段 + 归属身份。 */
type AttemptJson = AttemptRecord & {
  experimentId: string;
  /** 所属（或携带来源）快照的 startedAt。 */
  snapshotStartedAt: string;
};

interface LeaderboardJson {
  experiments: Array<{
    experimentId: string;
    agent: string;
    model?: string;
    /** 该 experiment 现刻水位来源快照(去重「保留最新快照」同一口径)的 SnapshotMeta.facts 原样转发。 */
    facts?: Record<string, string | number | boolean>;
    summary: {
      selectedEvalIds: string[];
      missingEvalIds: string[];
      passRate?: number;       // 通过制 / 混型
      totalScore?: number;     // 计分制 / 混型
      totalTokens?: number;
      totalCostUSD?: number;
      avgDurationMs?: number;
    };
    evals: Array<{ evalId: string; attempts: AttemptJson[] }>;
  }>;
}

interface CompareJson {
  baseline: string;            // experiment id
  conditions: string[];        // 全部条件，顺序同 scope.experiments
  rows: Array<{
    evalId: string;
    /** 各条件判定不一致时 true（翻转标记 ⇄ 的数据面）。 */
    flipped: boolean;
    cells: Record<string, {    // 键是 experiment id；缺席条件无键
      scoring: "pass" | "points";
      verdict: AttemptRecord["verdict"];
      /** 计分制的题目级挣分；通过制省略。计分制没有满分分母。 */
      totalScore?: number;
      attempts: string[];      // locators
      totalTokens?: number;
      totalCostUSD?: number;
      historical: boolean;     // ↩ 时效标注的数据面
    }>;
    /** 键是非基准 experiment id；任一侧缺数据时无键。 */
    delta?: Record<string, { score?: number; tokens?: number; costUSD?: number }>;
  }>;
  /** 各条件自身覆盖面的描述，不用于直接归因。 */
  totals: Record<string, {
    scoringComposition: "pass" | "points" | "mixed";
    passed?: number; denominator?: number; // pass / mixed
    totalScore?: number;                   // points / mixed
    totalTokens?: number; totalCostUSD?: number;
  }>;
  /** 只在每个条件与 baseline 的共同 eval 集上计算；键是非基准 experiment id。 */
  pairedDelta: Record<string, {
    commonEvalIds: string[];
    /** mixed 时各自在对应题型子集配对，不能共用一个含混分母。 */
    pass?: { evalIds: string[]; passRatePoints: number };
    points?: { evalIds: string[]; totalScore: number };
    tokens?: number;
    costUSD?: number;
  }>;
}

interface UsageJson {
  attempts: Array<{
    locator: string; experimentId: string; evalId: string; attempt: number;
    verdict: AttemptRecord["verdict"];
    turns?: number;            // 事件流派生；无 events 时省略
    toolCalls?: number;
    usage?: Usage;             // 落盘原样
    uncachedInputTokens?: number; // 派生：两个输入都在才出现
    estimatedCostUSD?: number;
  }>;
}

interface ExecutionJson {
  attempts: Array<{
    locator: string;
    turns: Array<{
      label: string;           // turn1…，与 --timing / diff 同一枚 token
      status: string;
      cards: Array<{
        /** 展开句柄，如 "t2.c3"，与 text 面截断尾巴同源。 */
        handle: string;
        kind: "user" | "assistant" | "thinking" | "tool" | "skill" | "subagent";
        /** 事件字段原样（含 truncated 标记）；不在 JSON 层做卡片预览截断。 */
        event: unknown;
        /** 唯一关联的 OTel span 时间；关联不上时省略。 */
        otel?: { startOffsetMs: number; durationMs: number };
      }>;
    }>;
    /** 非零 Sandbox 命令；字段来自 commands.json，按 timing 节点时序排列。 */
    failedCommands: FailedCommandEvidence[];
    /** --grep 时只含命中的卡片；无 --grep 为全量。 */
    grep?: { pattern: string; matches: number };
  }>;
}

interface TimingJson { attempts: Array<{ locator: string; phases: PhaseTiming[]; tree: TimingNode[] }>; }
interface DiffJson    { attempts: Array<{ locator: string; summary: DiffData; windows?: DiffWindow[] }>; }
interface HistoryJson {
  sections: Array<{
    experimentId: string; evalId: string;
    executions: Array<Pick<AttemptJson,
      "locator" | "verdict" | "startedAt" | "durationMs" | "estimatedCostUSD"> & { summary: string }>;
  }>;
}
type AttemptViewJson = AttemptJson; // view: "attempt"（--source 同此，另带 sources 标注结构）
// view: "stats" 的 StatsJson 形状在 --stats 分篇声明,与其余视图同一信封。
```

## 边界

- 与 `--report` 互斥：报告树表达「怎么看」，`--json` 输出「是什么」（[范围契约](../show.md#选择结果范围)）。
- `--timing` 的 text 面预算（80 detail node）不适用于 `--json`：结构化输出恒为完整树，等价 `--timing=full` 的节点集合——预算是给人读的注意力护栏，不是事实过滤器。
- `--expand` 与 `--json` 组合是用法错误：JSON 形态本来就不截断卡片，没有可展开的东西。

## 相关阅读

- [Results Architecture](../../results/architecture.md) —— 被复用的落盘类型形状。
- [Results Lib](../../results/library.md) —— 需要自由组合读取时的库入口。
