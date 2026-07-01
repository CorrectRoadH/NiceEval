# Authoring —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。这一篇按这个顺序教:单轮、多轮、数据集扇出,以及沙箱型 fixture。评分手段(judge、匹配器、gate/soft)单独成篇,见 [Scoring](scoring.md)。

核心 DX 参考  eve

<--手动维护不允许删本段内容-->
# 核心原因
1. API应该容易理解，不会有二义性
1.1 负面例子，`t.messageIncludes(token)` 和 `t.calledTool(name, opts?)` 其它同样的断言API应该都是有同样语义的(比如同指是最后一次t.send，返回的消息，而不是有的是全部，有的是单轮)。如果用户想对整个消息进行评估，可以自己拼接、保存每轮的回复。
1.2 API唯一，如无必要，不应该有两个做一样事的API。

2. 给用户自组织的能力，而不是约定大于配置。用户不想学太多约定。
2.1 比如能不能把fixture、workspace(拷文件。通过基本API让用户自己去处理，而不是我们给一个值，让过程黑箱)
2.2 用户在用 langfuse、promptfoo 这种传统的 prompt 评估，有一些问题，像 dataset、golden，不是很适用于 Agent 的 case。 Agent eval可能更关注多轮对话、同时可能不同case的评估内容也不一样。所以统一的dataset。input与execpt output不太行。
2.2.1 如果用户真的需要dataset，可以通过for来实现这个功能
eve是怎么做到这个的
```ts
import { defineEval } from "eve/evals";
import { loadYaml } from "eve/evals/loaders";
import { equals } from "eve/evals/expect";
const doc = await loadYaml("evals/data/cases.yaml");
const rows = doc.evals as readonly { task: string; prompt: string; sql: string }[];
export default rows.map((row) =>
  defineEval({
    description: row.task,
    async test(t) {
      await t.send(row.prompt);
      t.succeeded();
      t.check(t.reply, equals(row.sql));
    },
  }),
```
<--end-->


## `defineEval` 的形状

```typescript
import { defineEval } from "fasteval";

export default defineEval({
  description?: string;            // 人读的描述,出现在报告里
  agent?: string;                  // 可选 eval-local 默认;常规运行由 experiment 选择 agent
  tags?: string[];                 // 供 --tag 过滤
  judge?: JudgeConfig;             // 覆盖默认评判模型
  reporters?: Reporter[];          // 这个 eval 专用的报告器
  timeoutMs?: number;              // 覆盖默认超时
  metadata?: Record<string, unknown>;
  async test(t) { /* 交互 + 断言 */ },
});
```

**禁止**提供 `id` / `name` —— 它们从文件路径推导:`evals/weather/brooklyn.eval.ts` → id `weather/brooklyn`。改名即改 id,不会腐烂。

## 单轮

```typescript
// evals/weather/brooklyn.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "布鲁克林天气查询",
  async test(t) {
    await t.send("布鲁克林今天天气怎么样?");

    // 作用域断言:在 test 结束后,对整次运行评估
    t.succeeded();
    t.calledTool("get_weather", { input: { city: "Brooklyn" }, count: 1 });

    // 值级断言:就地、立即评估
    t.check(t.reply, includes("晴"));
  },
});
```

`t.reply` 是最后一条 assistant 消息;`t.send(...)` 返回一个不可变的 **Turn**,带 `message` / `data`(结构化输出)/ `toolCalls` / `status`。

## 多轮

把每一轮的返回赋给局部变量,顺着断言:

```typescript
// evals/draft-then-send.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "先拟稿,确认后再发送",
  async test(t) {
    const draft = await t.send("帮我拟一封跟进邮件。");
    draft.expectOk();                          // 上一轮若失败,这里抛
    t.check(draft.message, includes("此致"));
    t.judge.closedQA("语气是否专业", { on: draft.message }).atLeast(0.6);

    await t.send("好,发出去。");
    t.calledTool("send_email");
  },
});
```

需要并行的独立会话时用 `t.newSession()` 开一条互不干扰的对话线。

### 多轮里评整段对话

多轮最容易踩的坑:**judge 默认只看最后一轮**(`t.reply`),而 `t.messageIncludes` 这类 run 级断言看的是**所有轮**——作用域不一致。完整的「三层作用域」规则与每条断言看哪一轮,见 [Assertions · 作用域:三层](assertions.md#作用域三层看哪一轮)。

要让 judge 评「整段多轮对话」(典型:跨轮一致性),别用默认材料,把全程对话拼出来显式喂进去:

```typescript
await t.send("这张图里有什么?");          // 第一轮:看图
await t.send("背景是什么颜色?");          // 第二、三轮:纯文字追问,考跨轮记忆
await t.send("中间那个形状是什么颜色的?");

// judge 默认 on: t.reply(最后一轮)。要评"整段三轮",传整段对话:
t.judge
  .score("助手是否始终基于第一轮的图片作答?", { on: t.transcript.text() })
  .atLeast(0.7);
```

`t.transcript.text()` 把整次运行的对话拼成 `role: text` 多行文本;需要更原始的控制就用 `t.transcript.events()` 自己过滤拼接。

## 数据集扇出

一个文件默认导出**一个数组**,就扇出成多个 eval。这是写数据集的规范方式:

```typescript
// evals/sql.eval.ts
import { defineEval } from "fasteval";
import { loadYaml } from "fasteval/loaders";
import { equals } from "fasteval/expect";

const doc = await loadYaml("evals/data/sql-cases.yaml");
const rows = doc.cases as { task: string; prompt: string; sql: string }[];

export default rows.map((row) =>
  defineEval({
    description: row.task,
    async test(t) {
      await t.send(row.prompt);
      t.succeeded();
      t.check(t.reply, equals(row.sql));
    },
  }),
);
```

```yaml
# evals/data/sql-cases.yaml
cases:
  - task: 统计用户数
    prompt: 查出 users 表的总行数
    sql: SELECT COUNT(*) FROM users;
  - task: 最近订单
    prompt: 查出最近 10 条订单
    sql: SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;
```

生成的 id:`sql/0000`、`sql/0001`……(零填充 4 位,稳定可引用)。`loadJson` 同理。

## Agent 由 experiment 选择

eval 默认保持 agent-neutral,只描述"测什么"和"怎么算对"。agent 由 `experiments/` 里的 `defineExperiment` 选择,它的能力决定 `t` 能干什么:

```typescript
// experiments/local.ts
export default defineExperiment({
  agent: myAgent,
  runs: 1,
});
```

常规运行时,agent 由 experiment 提供 —— 这让同一份 eval 能换着被测对象跑(本地 vs 部署、agent A vs agent B),同时运行配置可签入、可复现。怎么写一个 agent,详见 [Agents 与 Adapters](agents-and-adapters.md)。

## 沙箱型:Fixture

评一个 coding agent 时,Task 不写在代码里,而是一个磁盘目录(fixture)。约定:

```
evals/fixtures/create-button/
├─ PROMPT.md          # 给 agent 的任务(必需)
├─ EVAL.ts            # 验证测试,Vitest 风格(必需;或 EVAL.tsx)
├─ package.json       # 必须 "type": "module"
├─ src/               # 起始代码(可选)
└─ tsconfig.json
```

- **PROMPT.md** 是发给 agent 的提示词。
- **EVAL.ts** 是评分逻辑,**对 agent 不可见**(只在验证阶段才上传到沙箱),防止它看答案作弊。
- 其余文件是 agent 可见的 workspace。

Fixture 靠"目录里有 PROMPT.md"被自动发现,支持任意嵌套(`fixtures/api/auth/`)。无需为它写任何 `.eval.ts`。

### 在 EVAL.ts 里断言「行为」

除了断言结果文件,你还能断言 agent 干过什么 —— o11y 摘要被注入沙箱:

```typescript
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";

test("用脚手架命令初始化,而不是手搓", () => {
  const o11y = JSON.parse(readFileSync("__fasteval__/results.json", "utf-8")).o11y;
  const cmds = o11y.shellCommands.map((c: { command: string }) => c.command);
  expect(cmds.some((c) => c.includes("create-next-app"))).toBe(true);
});
```

可读字段见 [Observability](observability.md#o11y-summary)。

### 程序化定义(可选)

fixture 目录是磁盘约定,天生「一个目录一个 eval」,扇不出数组——想要 50 个结构相同、只换 prompt/断言参数的 coding-task 变体,要么手写 50 个目录,要么就需要能在 TS 里 `rows.map()` 生成的等价物。`defineAgentEval` 补的就是这个洞:把「数组即扇出」这条已经在会话型 eval 上成立的原则,延伸到沙箱型 eval,同时保持和 `defineEval` 一样的心智模型(同一个壳子,`t.send` 换成 `t.run()`)。

```typescript
// evals/refactor.eval.ts
import { defineAgentEval } from "fasteval";

export default defineAgentEval({
  description: "把回调改写成 async/await",
  prompt: "把 src/legacy.js 里的回调全部改写成 async/await,保持行为不变。",
  files: "./fixtures/legacy-callbacks",     // workspace 起始文件
  async test(t) {
    await t.run();                          // 驱动 agent
    t.sandbox.fileChanged("src/legacy.js");
    t.check(t.sandbox.diff.get("src/legacy.js"), includes("await"));
    await t.script("test");                 // 跑 npm run test
    t.sandbox.testsPassed();
  },
});
```

`defineAgentEval` 和 fixture 是同一件事的两种写法,分工看任务是异构还是同构:fixture 适合彼此**不同**的一次性任务(不同语言、真实项目脚手架);`defineAgentEval` 适合结构**相同、只换参数**的批量变体,复用同一套断言模板,靠数组扇出。两者共享同一套评分 / 运行 / 报告。

## 命名与组织约定

- 文件名以 `.eval.ts` 结尾才会被发现。
- 用目录表达分组:`evals/billing/refund.eval.ts` → `billing/refund`。
- 数据集放 `evals/data/`,fixture 放 `evals/fixtures/`(约定,非强制)。
- `description` 写给人看,id 给机器引用。

## 相关阅读

- [Assertions](assertions.md) —— `t.check` / 作用域断言的完整速查表(看哪一轮、来源哪里)。
- [Scoring](scoring.md) —— judge 细节、测试即评分、判决规则。
- [Agents 与 Adapters](agents-and-adapters.md) —— agent 三类 transport 与 agent 适配。
- [CLI](cli.md) —— 过滤、重试、并发等运行标志。
