# Scoring —— 架构

Scoring 将执行状态、记录的 Assertions 与 skip 信号折叠成 Verdict。matcher、作用域断言和 judge 最终都进入同一个 Assertion collector。

```text
value / scope / judge / sandbox / efficiency
                    │
                    ▼
              Assertion[]
                    │
        execution error + skip + strict
                    │
                    ▼
                 Verdict
```

## 设计主题

- [作用域绑定](architecture/scopes.md)
- [Severity 与 Verdict](architecture/severity-and-verdict.md)
- [证据与完整性](architecture/evidence.md)

命名边界：**Assertion（输入态）** 是 matcher / 作用域断言 / judge 这些「怎么查」的表达（如 [`custom-assertions`](library/custom-assertions.md) 里 `function jsonValid(): Assertion`）；collector 把每次检查折叠成的「查出了什么」是 **`AssertionResult`（记录态）**。`Verdict` 表达整个 attempt 的互斥结果。多次 runs 的报告聚合通过率和平均耗时，不制造第五种 Verdict。

## 断言记录（AssertionResult）

`result.json` 的 `assertions` 数组元素，也是 [Severity 与 Verdict](architecture/severity-and-verdict.md) 判定规则的输入。字段契约单点定义在这里，[Results Format](../results/architecture.md#resultjson) 引用而不复写：

```typescript
interface AssertionResult {
  /** 断言描述:group 名或 matcher 摘要,show/view 失败行的标题。 */
  name: string;
  severity: "gate" | "soft";
  passed: boolean;
  /** 归一化得分:值断言 0/1,judge 等打分断言 0..1。 */
  score: number;
  /** soft 断言的 .atLeast(x) 阈值;没有设阈值则省略。 */
  threshold?: number;
  /** 失败证据摘要:matcher 名与期望值 / 实际值的有界文本预览,供 show/view 直接展示。 */
  expected?: string;
  received?: string;
  /** 断言在 eval 源码中的位置(file:line:col),`--eval` 把失败标回源码行的锚。 */
  loc?: string;
}
```

`expected` / `received` 是有界预览而不是原始值——原始证据在 `events.json` / `diff.json` 等 artifact 里；判定只消费 `severity` / `passed` / `score` / `threshold` 四个字段。
