# Proposal：gate 断言预览的 shape 修正 + 截断脚注补齐 + errored 聚类

来源：MemoryBench 仓库(`coding-agent-memory-evals`)dogfooding `niceeval show` 时,triage 一批 38/50 errored + 2 个真实 gate 失败,发现两处独立问题。不是假设,两处的 BEFORE 例子都是对着真实 `.niceeval/` 数据跑出来的(react-hook-form/pr-13476 `@1t12uf8t`;errored 聚类的三类根因分布来自同一批 50 attempts 的真实 result.json)。

## 1. 问题陈述

两个问题结构不同,不该用同一个机制解决。

### 1a. gate 断言预览:预算没错,形状错了,且指向"完整值"的提示是假的

`summaryText()` 的 240 字符上限(`src/scoring/display.ts:10,20-25`)本身是对的、已落地的设计(见 `exp-show-fullreuse-truncation-handoff.md`),它的注释写得很清楚:"Human/Agent 摘要是一条终端事实行，不是完整证据面"。给索引行设上限没有问题。

**真正坏掉的地方**,对着真实数据 `@1t12uf8t`(`react-hook-form/pr-13476` 的 `commandSucceeded()` gate 失败,`received` 原文 3780 字符)验证:

```
$ niceeval show react-hook-form/pr-13476
...
attempt 1 · compare/codex-gpt-5.6-luna · failed · 19m 45s · 941.4k tokens · $1.06
  ✗ gate commandSucceeded() — score 0 · received: exit 1 · "…led, 1 total Tests:
  1 failed, 72 passed, 73 total Snapshots: 3 passed, 3 total Time: 3.405 s Ran
  all test suites matching src/__tests__/useFieldArray.test.tsx." output tail: ✓
  should unmount field array and remove its reference …

artifacts: .niceeval/compare_codex-gpt-5.6-luna/.../react-hook-form/pr-13476/a0/
attempt locator: @1t12uf8t
next: niceeval show @1t12uf8t [--source|--execution|--diff]
```

按提示的 `next:` 往下走:

```
$ niceeval show @1t12uf8t --source
...
99 ✗     t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), com… (+17 more chars)
     gate · commandSucceeded() · expected exit 0 · received exit 1 · "…led, 1
     total Tests: 1 failed, 72 passed, 73 total Snapshots: 3 passed, 3 total
     Time: 3.405 s Ran all test suites matching
     src/__tests__/useFieldArray.test.tsx." output tail: ✓ should unmount field
     array and remove its reference …
...
full failure detail: niceeval show @1t12uf8t
full eval source: .niceeval/compare_codex-gpt-5.6-luna/.../a0/sources.json
```

和第一行**逐字节相同**。`--source` 自己的尾行写着 `full failure detail: niceeval show @1t12uf8t`——但那个目标走的是同一个 240 字符 cap。**这是一个可复现的、循环指向的提示,不是缺功能。** 真正有诊断价值的事实——挂的是 `useFieldArray › with resolver › should preserve nested field errors after remove when both root and field errors exist`,`expect(received).toBeInTheDocument()` 在 `useFieldArray.test.tsx:842`——落在原始字符串第 1500 字符附近,在所有终端视图里都不可见。它原样躺在磁盘上的 `result.json`(`assertions[0].received` 就是完整 3780 字符),但没有任何输出告诉你去那里找。

**根因,精确定位**:同一个 `summaryText()` cap 被三处独立调用点各自套用,彼此从未收敛到统一的"截断脚注"契约:

- `assertionLine()`,`src/show/render.ts:140-158` —— 喂给 `evalDetailText()`(`show <eval-id>`)
- `evalAssertionDetailLine()`,`src/show/render.ts:418-439` —— 喂给 `evalSourceText()`,即 `--source` 切面
- 第三处,独立实现——`src/report/components/attempt-detail/faces.ts:77-93` 的本地 `assertionLine()`(`attemptAssertionsText`),被 `attemptSourceText()`(`faces.ts:105-112`)复用——喂给裸 `show @<locator>` 默认页(report 的 `AttemptDetail` 管线,上面两段命令的输出就是它产出的)

三处都不打截断脚注。对比其它证据切面已经在遵守的文档契约:"截断永远如实标注剩余数量和原始 artifact 路径"——`--diff` 的脚注(`M src/components/Button.css 18 lines` → `full diff: fixtures/button/a1/diff.json`)和 `--timing` 的"N nodes not shown"都做到了;断言预览截断是 `show` 里唯一没做到的一处。还有一处**过时注释**,`faces.ts:82-85` 写着"完整值仍在 web 面...与 --source 里原样可查"——web 面是真的(`AttemptAssertions.tsx`/`AttemptSource.tsx` 直接插值 `{a.received}`,没有 `summaryText`),**`--source` 是假的**(上面复现过)。注释描述的是代码已经不再具备的行为。

**排除相邻机制,避免混淆**:per-profile 抑制上限(human/agent/ci 10/5/50,见 `exp-output-feedback-models.md`)管的是 `exp` 实时反馈流,不是 `show`;`dedupeKey` 去重的是同一个 attempt 内重复的 diagnostic;`dedupeAttempts` 按身份折叠跨快照的重复 attempt。都不涉及断言预览的 shape 或截断脚注。

### 1b. errored 攻击无聚类——确认是纯新增,且在本仓库真实数据上验证过

`results-data.mdx:15` 明确写"不合并、不聚合、不去重",留给 report 组件做。现有唯一为这个 triage 场景造的组件——`FailureList`(`src/report/components/entity-lists/index.tsx:193-238`,注释是"「现在有哪些失败要处理」的成品组合件")——过滤出 `failed`/`errored`,按时间排序,仅此而已,不聚类。而且它根本**没接进内置 `standard` report**(`src/report/built-in/standard.tsx:32-71`:`report` 页是 `Hero + ScopeWarnings + CopyFixPrompt + ExperimentComparison`,`attempts` 页是无过滤的 `<AttemptList />`)——所以文档写的"最小阅读路径"第一步、裸 `niceeval show`,根本走不到 `FailureList`。六份 plan 笔记里没有一份提过"按根因聚类 errored attempts"这个方向。

对着本仓库自己 `.niceeval/` 的真实数据统计(50 attempts,一次 compare 矩阵跑下来):

```
23  sandbox.create | unexpected-error | 404: template 'memory-evals-codex-mempal-...' not found
12  eval.run        | turn-failed      | This send returned failed (turn status = failed): agent run exited with code 1 · ...
 9  sandbox.create | unexpected-error | Rate limit exceeded, please try again later - you have reached the maximum numbe...
 3  agent.run       | timeout          | attempt timed out (1200000ms)
 1  eval.run        | timeout          | attempt timed out (1200000ms)
```

这批真实数据带出一个例子里容易忽略的坑:**`(phase, code)` 单独不够做分组键**。23 条模板不存在和 9 条限流,`(sandbox.create, unexpected-error)` 这个 pair 完全相同,只有 `message` 能把它们分开。任何聚类设计都得在 `message` 内容上做键,不能只用结构化的 `phase`/`code`。见第 6 节。

## 2. 设计:一处是 flag-pattern 内的形状修正,一处是完全不同的机制

**问题 1a 不需要新 flag。** 不缺证据"类别"——`--source` 本来就是为了把断言对回源码行,它文档里写的角色("eval check 内容 + 断言结果",`viewing-results.mdx:151-167`)完好。坏的是 (a) 紧凑预览的 240 字符预算花在了 boilerplate 上而不是有区分度的事实,(b) 两处提示语(`evalDetailText` 的 `next:` 行、`evalSourceText` 的尾行)指向的目的地根本不解决截断,而真正有完整值的地方——磁盘上的 `result.json`——从没被点名过。修法是:**给紧凑行更好的形状,把"截断必须标注 artifact 路径"这条已经在 `--diff`/`--timing` 上生效的契约,补齐到唯一缺失的这一处。** 不加新 flag、不加新页——这是证据切面架构内部的同高度 parity 修正。

**问题 1b 需要不同的机制,根本不是 flag 的事。** 这不是单个 attempt 的证据问题(没有东西可以对着一个 locator 往下钻)——是跨 attempt 的聚合,读层已经明确把这个责任甩给 report 组件(`results-data.mdx:15`)。合理的形状是一个新 report 组件,直接对标结构相同的 `FailureList`(`entity-lists/index.tsx:193-238`),接进内置 `standard` report 的 `report` 页(`report/built-in/standard.tsx:36-44`),这样裸 `niceeval show`——文档写的 triage 第一步——不用加任何参数就能看到。

## 3. BEFORE / AFTER:gate 断言预览(真实内容,`react-hook-form/pr-13476`,`@1t12uf8t`)

**BEFORE**(本次会话实跑捕获):

```
$ niceeval show react-hook-form/pr-13476
...
attempt 1 · compare/codex-gpt-5.6-luna · failed · 19m 45s · 941.4k tokens · $1.06
  ✗ gate commandSucceeded() — score 0 · received: exit 1 · "…led, 1 total Tests:
  1 failed, 72 passed, 73 total Snapshots: 3 passed, 3 total Time: 3.405 s Ran
  all test suites matching src/__tests__/useFieldArray.test.tsx." output tail: ✓
  should unmount field array and remove its reference …

artifacts: .niceeval/compare_codex-gpt-5.6-luna/.../react-hook-form/pr-13476/a0/
attempt locator: @1t12uf8t
next: niceeval show @1t12uf8t [--source|--execution|--diff]
```

提示列出的每个 flag 都复现同一条被截断的行,失败测试的名字和断言错误永远不出现。

**AFTER**(提案):

```
$ niceeval show react-hook-form/pr-13476
...
attempt 1 · compare/codex-gpt-5.6-luna · failed · 19m 45s · 941.4k tokens · $1.06
  ✗ gate commandSucceeded() — score 0 · received: exit 1 · ● useFieldArray ›
  with resolver › should preserve nested field errors after remove when both
  root and field errors exist — expect(received).toBeInTheDocument() …
  (truncated · full value: .niceeval/.../react-hook-form/pr-13476/a0/result.json
  → assertions[0].received)

artifacts: .niceeval/compare_codex-gpt-5.6-luna/.../react-hook-form/pr-13476/a0/
attempt locator: @1t12uf8t
next: niceeval show @1t12uf8t --source   (把失败断言对回源码行)
```

两处改动相互独立,单独一个就能发:

1. **形状**:240 字符预算优先展示 jest 的 `●` 失败块标记(和 `commandSucceeded` 已经在做的"exit code + tail"这类 matcher 感知 reshape 是同一类,`previewCheckedValue` 在 `src/context/context.ts` 已经这么处理过一次),而不是先展示 pass/fail 统计这类 boilerplate。
2. **截断脚注 parity**:`summaryText()` 真正发生截断时,这行要说明完整值在哪——和 `--diff`/`--timing` 已经在遵守的契约一致,补到唯一缺失的这处。`evalSourceText` 的尾行(`render.ts:518`)不再断言一件不成立的事;要么去掉"full failure detail"这行,要么直接指向 `result.json` 而不是又转一圈回到同一个 cap。

## 4. BEFORE / AFTER:裸 `niceeval show` 里 errored attempts 的聚类

示例计数:23× `sandbox.create` 模板不存在、10× `eval.run` 并发限流 `turn-failed`、4× `agent.run` timeout(其中 2 条实际和上面并发限流同根因)= 37 条归类 +1 条未归类,对齐声明的 38(遵循 `AttemptList` 已有的"如实报告剩余数量,不静默截断"契约)。这不是虚构结构——基本就是本仓库 `.niceeval/` 里真实出现的分布(见 1b)。

**BEFORE**:

```
$ niceeval show
Eval Results
Last run 2026-07-20 14:02 · composed from 1 snapshot

Pass rate 24.0% · 1 experiment · 50 evals · 50 attempts · 12 passed · 0 failed
· 38 errored · Total cost $9.80 (Cost available for 12/50 attempts)
...
```

要看到具体是哪 38 个,现有的下一步(`--page attempts`)给的是打平的、按时间排的列表:

```
$ niceeval show --page attempts
✗ errored  weather/miami            @a1B2c3   sandbox.create · unexpected-error · 404: template 'memory-evals-codex-mempal-…' not found
✗ errored  downshift/pr-1456        @g7H8i9   eval.run · turn-failed · This send returned failed (turn status = failed): agent run exited with code 1 …
✗ errored  weather/austin           @d4E5f6   sandbox.create · unexpected-error · 404: template 'memory-evals-codex-mempal-…' not found
✗ errored  react-tooltip/pr-970     @k1L2m3   eval.run · turn-failed · This send returned failed (turn status = failed): agent run exited with code 1 …
✗ errored  react-hook-form/pr-13476 @1t12uf8t agent.run · timeout · attempt timed out (1200000ms)
… (还有 33 行,一条一个 attempt,按时间排,不分组)
```

人得把 38 行全读完才能发现其实只有 4 种模式。

**AFTER**——`report` 页新增一块,裸 `niceeval show` 就看得到,不加任何 flag:

```
$ niceeval show
Eval Results
Last run 2026-07-20 14:02 · composed from 1 snapshot

Pass rate 24.0% · 1 experiment · 50 evals · 50 attempts · 12 passed · 0 failed
· 38 errored · Total cost $9.80 (Cost available for 12/50 attempts)

Error clusters · 38 errored → 4 named + 1 other
  23×  sandbox.create · unexpected-error · template 'memory-evals-codex-mempal-…' not found
       first: weather/miami @a1B2c3 · latest: yet-another-react-lightbox/commit-… @z9Y8x7
       → niceeval show @a1B2c3
  10×  eval.run · turn-failed · This send returned failed (turn status = failed): agent run exited with code 1 …
       first: downshift/pr-1456 @g7H8i9 · latest: react-tooltip/pr-970 @k1L2m3
       → niceeval show @g7H8i9
   4×  agent.run · timeout · attempt timed out (1200000ms)
       related: 2 of these followed the same concurrency-limit condition as the eval.run cluster above
       first: react-hook-form/pr-13476 @1t12uf8t
       → niceeval show @1t12uf8t
   1×  other (no shared phase+code+message with ≥2 other attempts)
       → niceeval show @m3N4o5

niceeval show --page attempts   # 打平的按时间列表,不分组
```

"related:" 那行是这份 mockup 里人工标注的说明,不是工具自动推断出来的结论——自动推断的边界见第 6 节。

## 5. 每一处分别解决什么问题

- **形状修正(§3.1)**:解决"240 字符预算花在了错的 240 个字符上"。不改展示多少,改的是**哪部分内容**赢得预算——让 triage 里最常见的问题("模型到底有没有修对,还是隐藏测试和实现耦合太紧")能直接从紧凑行回答,不用打开任何 artifact。
- **截断脚注 parity(§3.2)**:解决"紧凑行确实不够用时,打印出来的下一步是错的"。不加能力——让一个本来就成立的事实(完整值就在 `result.json` 里)变得可发现,并且不再让两处提示语断言一件已经验证为假的事。
- **`ErrorClusters` 组件(§4)**:解决"N 个 errored attempts 看起来像 N 个独立问题,实际上是 3-4 个"。不改变已有数据——把人/agent 从裸 `niceeval show`(文档里 triage 流程的第一步)看到的第一眼,从"一堵长得都差不多的失败墙"变成"按根因排好、每条带 locator 的列表"。
- **`1× other` 兜底行**:解决"聚类不能让总数看起来变小"——这是 `AttemptList` 自己已有的不变量("如实报告剩余数量,不静默截断")套到一个当时还不存在的新组件上。

## 6. 实现要点与开放问题

### 问题 1a

- **这是穿线改动,不是预算改动**:`assertionLine()`(`show/render.ts:140`)和 `faces.ts:77` 的本地 `assertionLine()` 目前只接收 `AssertionResult`,没有 artifact 路径。打脚注需要在两个调用点(`render.ts:296` 的 `evalDetailText` 内、`faces.ts:94`/`113` 的 `attemptAssertionsText`/`attemptSourceText` 内)把 attempt 的 artifact 目录穿进去,还有第三处 `evalAssertionDetailLine`(`render.ts:418-439`,被 `evalSourceText` 调用,它已经拿到 `artifactPath` 了,三处里最好改)。
- **形状修正是 matcher 特定的**:只有 `commandSucceeded()` 的 `received` 带 jest/pytest 结构可以利用(`●`/`FAILED` 标记)。`previewCheckedValue`(`src/context/context.ts`)已经做过一次这类 reshape(exit code + tail)——扩展它去识别并优先展示第一个失败块标记,是一处有边界的、matcher 局部的改动,不动 `summaryText()` 本身(它对没有内部结构的 matcher 应该继续保持"笨"、通用、正确的 240 字符 cap)。
- **测试面**:`scoring/display.test.ts` 和 `attempt-components.test.tsx:409-419` 的双渲染等价测试目前只覆盖短值(`"4"`/`"3"`),没有测过真实场景下 >240 字符的截断分支。新测试应该用形似 `@1t12uf8t` 的 fixture(前后带 boilerplate 统计的 jest 失败块),这样形状修正才有回归防护,不会悄悄退回"前 N 个字符,不管是什么"。
- **顺手的小清理**(非本提案核心,按仓库自己的 dogfooding 惯例提一句):`faces.ts:82-85` 那条"--source 里原样可查"的注释,应该在脚注 parity 改动的同一个 PR 里一并改掉,反正是同三行。
- **不建议**:加一个新的 `--full`/`--reason` flag。那会造出一个"内容就是另外三个切面、只是不设上限"的新切面,重新打开 `summaryText()` 本来就是为了防的那个洞(无界的值把 scrollback 冲爆),而且不像 `--timing=full`/`--diff` 那样有"有界 + artifact 指针"的纪律。如果以后确实想要一个更大但仍然有界的二级预览,应该单独给它一个明确的小预算(不是"全部"),这是开放问题,不在本提案范围。

### 问题 1b

- **新组件**:`ErrorClusters`,建在 `src/report/components/entity-lists/index.tsx`,和 `FailureList`(`index.tsx:193-238`)结构对称——同一套 `defineComponent`/text+web 双面模式,同一个 `attemptListData()` 输入。需要在 `entity-lists/compute.ts:41-56` 边上加一个新的计算函数,复用 `failureSummaryOf` 已经做的 `[phase, code, message]` 提取(`compute.ts:43`)。
- **分组键是开放问题,而且是有真实数据支撑的开放问题**:`(phase, code)` 单独不够,这次在本仓库自己的 `.niceeval/` 里就实锤了——23 条模板不存在和 9 条限流共享同一个 `(sandbox.create, unexpected-error)` pair,只能靠 `message` 分开。用 message 前缀(约 40-60 字符)碰巧能正确分开这两个真实簇(两条消息在前 20 字符内就分叉了),但如果消息里嵌了每次不同的变量(时长、hash、eval id),不做归一化就会过度碎片化。要不要归一化(去掉数字/hex 片段)、前缀取多长,留给实现者根据真实语料(本仓库的 `.niceeval/` 就是现成的)判断。
- **接线**:把 `<ErrorClusters />` 插进 `report/built-in/standard.tsx` 的 `"report"` 页(第 36-44 行),放在 `<ScopeWarnings />` 之后、`<ExperimentComparison />` 之前——这样裸 `niceeval show` 不用加任何 flag/page 参数就能看到,补上 `FailureList` 存在但从没接进默认路径这个真正的缺口。
- **范围决定,先说清楚不急着定**:v1 只聚类 `errored`,不聚类 `failed`。gate 断言失败本质上是逐 eval 定制的(不同 eval 不同断言),infra 式的大量重复(本提案针对的问题)在这里少见得多;要不要扩展到 `failed`,等真有证据(比如某个共享 fixture 的 bug 在很多 eval 上产生一模一样的 gate 失败)再做 v2。
- **明确不做的事**:自动跨簇根因关联(§4 mockup 里的"related:"那行)。判断 4 个 `agent.run` timeout 里有 2 个和 `eval.run` 并发簇同根因,需要跨形状完全不同的错误数据做推理(timeout 的 message 里根本不提"concurrency")——这是模糊推断问题,不是精确键聚类,把两者混在一起会让精确键聚类的输出变得不可信。这份设计要解决的是"让并排比较变快"(两个簇现在同屏可见,各带一个 locator),不是自动做因果判断。
- **测试面**:`dual-render.test.tsx` 已经有 `FailureList` 的 describe block(约 538 行),演示了 text/web 等价的惯例("text/web 共享同一份 data,不逐字比较")——新的 `ErrorClusters` describe block 应该照同样的模式写。
