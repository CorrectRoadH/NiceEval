# flags 还是 labels:用例手册

一句判据:**这个值会不会改变 attempt 里发生的事**——会,进 `flags`;只是给报表归类,进 `labels`。判据单点在 [Experiments · README](../README.md#defineexperiment-的形状),本篇按场景给搭配。

## 1. A/B 对比「开不开联网」

**场景**:两个实验同一个 agent,唯一差别是允不允许 agent 联网,要对比通过率。

```ts
// experiments/compare/online.ts
export default defineExperiment({
  agent: codex({ model: "gpt-5.4" }),
  flags: { webSearch: true },     // 改变 attempt 里发生的事 → flags
  evals: "*",
  sandbox: e2bSandbox(),
});
```

```ts
// evals 或 agent factory 里消费它
const agent = codex({ model: "gpt-5.4", webSearch: ctx.flags.webSearch === true });
```

**你会看到**:`flags` 进 `ctx.flags` / `t.flags`,参与可比性配置——改了值,已有缓存结果不再匹配,重跑是对的(它们本来就是不同条件下跑出来的)。

## 2. 给报表标注「这格用的是哪个记忆机制」

**场景**:三个实验分别接 baseline / mempal / nowledge,报告里想按「记忆机制」轴分组对比,但 agent 和 eval 根本读不到这个词。

```ts
export default defineExperiment({
  agent: mempalAgent(),
  labels: { memory: "mempal", line: "codex" },   // 只是报表坐标 → labels
  evals: ["memory/"],
  sandbox: e2bSandbox(),
});
```

**你会看到**:报告用 `label("memory")` 把三个实验排到同一根轴上;改 `labels` **不作废任何已有结果**——它不进运行时,改名、补标注都是零成本的报表操作。

## 3. 分不清的时候

**场景**:「模型名要不要放 labels?」「实验 id 本身算不算标注?」

**判据走一遍**:模型名改了,attempt 里跑的就是另一个模型 → 它是 `model` 字段(运行配置),连 `flags` 都不是;实验 id 是身份,由文件路径推导,两者都轮不到 `labels`。`labels` 只装「agent 和 eval 看不见、只有报表关心」的词。声明与消费的完整规则见 [Library · labels](../library.md#labels声明归类坐标不进运行时)。
