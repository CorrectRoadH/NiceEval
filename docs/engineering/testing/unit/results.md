# Results 怎么测

契约来源：

- [Results](../../../feature/results/README.md)
- [Architecture](../../../feature/results/architecture.md)
- [Library](../../../feature/results/library.md)
- [标注 Eval 源码 / Attempt 证据](../../../concepts.md)

Results 测试分为落盘格式、读取分类、身份与去重、Scope、Artifact 懒加载和
`copySnapshots`。不要用一个巨大目录快照同时承担这些责任。

本篇不 fake：构造数据，并为每例创建独立的真实临时目录，测试 writer、reader 与选择逻辑。真实运行的落盘与读回由
[E2E 功能域 · 报告与读面](../e2e/report.md)验收。

## Fixture 规范

**内存结果图**用于选择、去重和聚合前身份测试。Builder 必须要求写出会影响身份与选择的字段——`startedAt`
不由全局自增器偷偷生成，因为它是去重身份的一部分；测试读者必须能从 case 看出两条记录应该相同还是不同（规则见
[Harness](harness.md)）：

```ts
interface AttemptSpec {
  readonly evalId: string;
  readonly attempt: number;
  readonly startedAt: string;
  readonly verdict: "passed" | "failed" | "errored" | "skipped";
}
```

**临时落盘树**用于 writer/reader、版本识别、crash 残留和 artifact 懒加载。每例创建独立 `mkdtemp`
目录、收尾删除；每个 case 只写形成该分类所需的最小文件，不复制一份完整 `.niceeval` 树。

## 观察面

- **落盘面**：writer 写出的 JSON 文件内容与层级归属。断言字段**不存在**同样有效——TypeScript 保证不了 JSON 没有冗余字段。
- **读取面**：`openResults()` 句柄的分类（experiments /
  skipped）、Scope 与警告、artifact 方法返回值。
- **身份面**：locator、身份四元组、ref 归属。

写读两面在 round-trip 测试里互相对账：writer 写出的 reader 必须能读回，且事实位于契约声明的唯一位置。

## 覆盖规范

- **落盘格式**：`snapshot.json` 开始写入、`snap.finish()` 唯一一次补 `completedAt`
  与快照级 diagnostics；`result.json` 只含 attempt 级事实（快照级字段以「不存在」断言）；不落
  `runId` / `invocationId` / Run
  Manifest 或跨实验成员关系；目录独占创建与撞名重试；artifact 缺省不生成、`null` 与 `[]`
  语义分离；截断唯一落点与 UTF-8 字符边界；源码两层落盘按内容哈希去重；locator 确定性派生与携带条目原样复制不重算；目录名只是清洗投影、权威身份在字段；轮标签在
  `diff.json`/时间树/send 标注三处逐字相等。
- **读取分类**：schemaVersion 不匹配（不论新旧）、坏 JSON、缺 snapshot.json、legacy 启发式各归各的 skipped
  reason 且携带诊断字段；无关 JSON 静默忽略；未知可选字段与未知 artifact 被接受；未收尾快照不是 skipped、attempt 照常可读。每类坏数据用形成该分类的最小文件构造。
- **Scope（`latest()`）**：每个 Experiment 只取最新结果快照。不跨结果快照拼 Eval，也不把 Attempt 平铺后再选。覆盖缺口写入
  `coverage`；`knownEvalIds` 与 `missingEvalIds` 使用并集分母。`filter`
  只删减，不新增，也不修改原 Scope。warnings 随幸存 Experiment 修剪。未收尾、缺
  `startedAt`、不可读结果快照分别产生结构化 warning，并给出下一步。Fixture 必须让“按结果快照选择”“逐 Eval 拼接”“平铺 Attempt”得到不同答案。
- **现刻水位（`current()`）**：按 Experiment ×
  Eval 选择包含该 Eval 的最新可比结果快照。配置不一致的旧结果快照不贡献，缺口写入
  `coverage.missingEvalIds`。`Scope.attempts` 物化选择结果；`Scope.snapshots`
  保留所有真实来源。每条 Attempt 的 locator 与 ref 仍指向原来源。同一 Experiment 可以保留多个结果快照。按真实 Snapshot 身份过滤一个来源时，只删除该来源的 Attempt，并重新计算覆盖缺口。Fixture 必须让同一 Experiment 同时有两个存活来源。

  完整场景见[读最近一批，还是每题的当前结果](../../../feature/results/use-case/latest-or-current.md)。

- **时效与 `fresh` 口径**：`attempt.carried` 是 `artifactBase`
  的读取面投影。携带的 Attempt，或来自更早结果快照的 Attempt，属于历史执行。`fresh: true`
  在两种选择口径下都排除历史执行；被排除的 Eval 进入覆盖缺口。Fixture 同时包含携带条目与跨结果快照拼入条目，使“只排携带”“只排旧来源”“两者都排”得到不同答案。
- **身份与去重**：reader 忠实保留重复、去重是消费方义务；同身份键取最新快照；`startedAt`
  缺失时宁可不去重也不误删并出警告；「缺才补」的字段拼合优先级；`ref` 指向条目所在落盘。
- **artifact 懒加载**：七个方法（`commands` / `events` / `trace` / `o11y` / `agentSetup` / `diff` /
  `sources`）缺文件一律 `null` 不抛；携带条目按候选顺序回退 `artifactBase`、原快照被清理后如实
  `null`；`sources()`
  的解引用去向；截断是磁盘事实原样读出；同 handle 记忆化。缺失、空、有值三态不合并成同一种 fixture 默认值。
- **标注源码与证据装配**：断言/send 标注的行映射与 unmapped 桶（never silently
  dropped）；轮与 turn 节点的配对规则和错位保护；行切分无幻影尾空行、CRLF/LF 归一；`AttemptEvidence`
  四个能力位以「数据真的存在且非空」为准、identity 与 locator 原样一致、execution 与 span 按 call
  id 关联不按名字猜。
- **Usage、facts 与失败命令证据落盘**：`Usage`
  每个字段只在协议真实提供时写入——fixture 要区分「省略」与「写 0 / 写 1」（尤其
  `requests`：无请求计数的协议不得落 `requests: 1`）；**桶恒互斥归一**是 adapter / 转换器 /
  transcript 解析器的落值义务：OpenAI 系口径（codex `cached_input_tokens`、Chat Completions /
  Responses / bub tape 的 `cached_tokens`、AI SDK `cachedInputTokens` 与
  `inputTokenDetails`、LangChain `input_token_details`）落 `inputTokens`
  前从输入总量扣掉缓存明细且不产生负数，互斥系口径（Anthropic、pi 简写）如实转发不扣减——fixture 的输入总量与缓存子集要选「扣与不扣结果可区分」的数值，缺缓存字段时输入总量原样保留（不虚构扣减）；每个生产点各锁一条自己的字段映射，扣减夹底（cached >
  input 时归 0）只在一处证明，不逐生产点复述；`fact()` 的作用域归属（sandbox hook / agent 上下文 →
  `AttemptRecord.facts`，experiment hook →
  `SnapshotMeta.facts`，runner 自动归属、调用方无法指定层级）、同作用域同 key 后写覆盖、key 词法（`[a-z0-9._-]{1,64}`）与非标量 value 的完整报错、experiment 级 facts 与
  `completedAt` 同批封口补写、facts 不参与 verdict
  / 指纹 / 可比性配置；读取面把两级 facts 原样读回不合并。`commands.json`
  只在有非零 Sandbox 命令时生成，`AttemptRecord.artifacts` 含 `commands`
  与文件存在同值;每条 evidence 的 timingNodeId / phase / display / exitCode / stdout /
  stderr 原样往返，stdout/stderr 复用 256 KiB 字符串截断与结构化 `truncated`
  标记；携带按 artifactBase 懒加载，`copySnapshots({ artifacts: ["commands"] })`
  物化后不留回退指针。
- **copySnapshots 与 resolveLocator**：目标非空即报错不合并、预检失败不留半成品；文件大小预检的整体失败与错误明细；产物自包含（解引用复制、重新去重、补
  `knownEvalIds`）；`resolveLocator` 只查内存、两类错误可分辨。

## 不这样测

- 不让 builder 隐藏 startedAt、attempt、experimentId 等身份字段。
- 不只断言 writer 写出了某个文件；还要断言事实位于正确层级且 reader 能读回。
- 不用一份巨大黄金目录覆盖版本、选择、去重和 artifact。
- 不把 `null`、空数组、零和缺文件合并成同一种 fixture 默认值。
- 不在测试里复刻 locator 派生或去重算法再对答案；期望值写死在 case 里。
