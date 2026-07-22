# 值断言

从 `niceeval/expect` 导入 matcher，再用 `t.check` 或 `t.require` 评分任意值。

```ts
import { includes, matches, isDefined } from "niceeval/expect";

const reply = await t.require(t.reply, isDefined("reply"));
t.check(reply, includes("Brooklyn"));
t.check(turn.data, matches(MySchema));
```

## `check` 与 `require`

- `t.check(value, matcher)` 同步记录断言并继续执行，适合一次收集多条结果。
- `await t.require(value, matcher)` 立即等待；不通过就按 gate 中止依赖它的后续代码，通过后返回原 value。

只有后续逻辑依赖这个值时才使用 `require`。

## 内置 matcher

| Matcher | 用途 | 默认严重度 |
|---|---|---|
| `includes(needle, opts?)` | 包含字符串或命中正则 | gate |
| `excludes(needle, opts?)` | 不包含字符串或不命中正则 | gate |
| `equals(expected)` | 深度相等 | gate |
| `matches(schema)` | Standard Schema / Zod 校验 | gate |
| `similarity(expected)` | `[0,1]` 编辑距离相似度 | soft（阈值 0.6） |
| `includesUrl(min?)` | 含至少 min 条（默认 1）去重后的 http(s) 链接 | gate |
| `hasSections(min?)` | 含至少 min 个（默认 2）Markdown 标题 | gate |
| `satisfies(predicate, label?)` | 自定义谓词 | gate |
| `isDefined(label?)` | 非 null / undefined | gate |
| `isTrue(label?)` / `isFalse(label?)` | 严格布尔判断 | gate |
| `commandSucceeded()` | 命令退出码为 0 | gate |

`includes` / `excludes` 的 `opts` 是 `{ stripComments?: boolean }`：`stripComments` 先剥掉代码注释再匹配，用于只对真实代码断言、不被注释里的字面量干扰：

```ts
t.check(t.sandbox.diff.get("src/weather.ts"), excludes(/console\.log/, { stripComments: true }));
```

`satisfies` 的 `predicate` 是 `(value: unknown) => boolean`，真记 1 分、假记 0 分；`label` 进报告名：

```ts
t.check(turn.data, satisfies((v) => Array.isArray(v) && v.length <= 5, "最多 5 条结果"));
```

`similarity(expected)` 是归一化编辑距离（1 − Levenshtein ÷ 较长串长度），不是语义相似度——同义改写、语序调整会得低分，适合期望输出接近逐字稳定的场景；语义评价用 [LLM-as-judge](judge.md)。

`includesUrl(min?)` / `hasSections(min?)` 是**内容形状断言**：不判语义，只判回答具不具备预期产出的形状（带来源链接、有小节结构）。它们的定位是没有 Judge key 时的兜底——比「断言输入里本来就有的词」强一个量级（复读题目糊弄不过去），但判不了内容真伪；有 Judge 时语义质量仍交给 [LLM-as-judge](judge.md)。URL 按去重后的完整链接计数；标题按行首 `#` 到 `######` 计数。

## 改严重度与阈值

每个 matcher 都可以链 `.gate(threshold?)`、`.atLeast(threshold)`、`.soft()` 或 `.optional()`，返回新的不可变 matcher，原实例不变、可复用：

- `.gate(t?)`：变硬门槛，不及格即整条 eval 不通过。省略阈值用默认通过线 1（0/1 即「命中」），给了阈值按「分数 ≥ 阈值」。
- `.atLeast(t)`：降级为带通过线的 soft——低于 `t` 照实记 failed，默认不影响 verdict，`--strict` 下才计入。`t` 是分数线：0/1 matcher 写 `.atLeast(1)`，打分 matcher（`similarity` 这类 0..1 的）写 `.atLeast(0.7)`。
- `.soft()`：降级为纯记录的 soft，不设线，分数落盘、永不 fail；无参数，要设线用 `.atLeast(t)`。
- `.optional()`：允许这条断言证据缺席——评不了时只记录 `unavailable`，不把 attempt 拖成 `errored`；与 severity 正交，主要用在依赖证据通道的作用域断言和 judge 上（[折叠规则](../architecture/severity-and-verdict.md#证据不可用unavailable不折叠成通过)）。

```ts
t.check(t.reply, similarity("布鲁克林今天晴。").atLeast(0.9)); // 收紧默认的 0.6
t.check(t.reply, similarity("布鲁克林今天晴。").gate(0.8));    // 相似度不足直接挂
```

Severity 折叠成 Verdict 的完整规则见 [Severity 与 Verdict](../architecture/severity-and-verdict.md)；每个 matcher 失败时在 show / view 里显示什么，见 [断言与 Turn 的展示](display.md)。

## 分组

`t.group(title, fn)` 只组织报告，不改变各断言分数或严重度：

```ts
await t.group("天气查询", async () => {
  t.check(t.reply, includes("Brooklyn"));
  t.calledTool("get_weather");
});
```

分组可以嵌套，返回 `fn` 的返回值。
