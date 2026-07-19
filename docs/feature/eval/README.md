# Eval —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。共享同一套逻辑的数据集可以从同一文件默认导出数组或 keyed record；数组按稳定序号生成 id，record 按稳定业务 key 生成 id。

## `defineEval` 的形状

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description?: string;            // 人读的描述,出现在报告里
  tags?: string[];                 // 供 --tag 与 ExperimentDef.evals 谓词过滤
  judge?: JudgeConfig;             // 覆盖默认裁判模型
  reporters?: Reporter[];          // 这个 eval 专用的报告器
  timeoutMs?: number;              // 覆盖默认超时
  environment?: string;            // 这条 eval 需要的环境 profile id；也可由 ExperimentDef.evals 谓词读取
  diff?: { include?: string[]; ignore?: string[] };   // 调整 agent diff 的归因排除清单(仅沙箱型;见下)
  metadata?: Record<string, unknown>;
  async setup(sandbox, ctx) { /* 这条 eval 的沙箱预置;ctx 可报告 progress/diagnostic */ },
  async teardown(sandbox, ctx) { /* 回收 setup 的 fixture;setup 时点走到过才触发 */ },
  async test(t) { /* 交互 + 断言 */ },
});
```

`environment` 声明这条 eval 需要哪种**环境 profile**，例如 `"python-3.9-astropy-4.2"`。它是非空、不透明的稳定 id：eval 不在这里选择 Docker image、E2B template 或 Vercel snapshot，也不因此绑定某个 provider。profile 到具体预制产物的翻译是一张纯数据表，写在 sandbox spec 工厂的 `environments` 参数上（一个 provider 一份，多个实验复用），见 [Sandbox · 按 environment 选预制产物](../sandbox/library/prebuilt-environments.md#按-environment-选预制产物)。省略此字段的 eval 从 spec 的基础产物起步；数据集扇出（一个文件默认导出数组或 record）时整组条目共享同一声明。选中 eval 声明的 profile 在所用 spec 里缺表项是启动期配置错误。此字段以解析后的产物参数计入 eval fingerprint——它映射的产物变化会让该 eval 重跑；remote Agent 不创建沙箱，此字段只参与指纹。

`diff` 调整[变更归因](../sandbox/architecture.md#变更归因send-窗口与分类账)的排除清单,两个数组都是 **gitignore 风格 glob**(workdir 相对):默认排除 `.git/`、`node_modules/`、常见构建产物与包管理器缓存目录;`ignore` 在默认清单上追加排除;`include` 优先级最高,把匹配路径从默认清单与 `ignore` 中显式加回(要评分 `node_modules` 里被 agent patch 的文件就 include 它)。合成规则固定为「默认 ∪ ignore,再被 include 打洞」,清单在分类账锚点时冻结,运行中不可变。

`setup` 是**这条 eval 的任务层预置**:拿到的是完整 `Sandbox`(不是 `test` 里那个受限的 `t.sandbox` 视图),在环境层钩子与变更分类账锚点之后、`agent.setup` 与 `test(t)` 之前跑,用来准备这次任务的素材(例如 `npm install` 起始项目的依赖);它的写入是 eval 归因,不会进 agent diff。第二个参数是绑定到 `eval.setup` 的窄上下文,可用 `ctx.progress(...)` 报告短期 activity、用 `ctx.diagnostic(...)` 报告永久 warning/error。`teardown` 是它的成对收尾:attempt 收尾链的第一段(`eval.teardown` → `agent.teardown` → `sandbox.teardown`),当且仅当 `setup` 的时点走到过才执行(`setup` 抛错、`test` 抛错都不豁免);要把 `setup` 的产物传给 `teardown`,以 `sandbox` 实例作键存取——并发 attempt 共享同一模块,普通模块变量会互相覆写(写法见 [Library · setup 与 teardown](library.md#setup-与-teardown任务夹具的起与收),四层统一成对语义见 [Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它))。它与另外两层 setup 分工不同:环境层的 `sandbox.setup`(不知道跑哪个 eval)、协议层的 `agent.setup`(装 CLI、写鉴权),见 [Sandbox](../sandbox/README.md)。

**禁止**提供 `id` / `name` —— 它们从文件路径推导:`evals/weather/brooklyn.eval.ts` → id `weather/brooklyn`。改名即改 id,不会腐烂。

单轮、多轮、数据集扇出、沙箱型的完整写法见 [Library](library.md);API 取舍背后的设计依据见 [Architecture](architecture.md)。评分手段(judge、匹配器、gate/soft)单独成篇,见 [Scoring](../scoring/README.md)。

## 相关阅读

- [Library](library.md) —— 单轮、多轮、HITL、数据集扇出、沙箱型的完整写法与命名约定。
- [Eval Context](library/context.md) —— `t`、`session`、`turn` 怎样驱动会话和读取结果。
- [Architecture](architecture.md) —— 为什么作用域断言按接收者(`t` / `session` / `turn`)分层,对齐 eve 的设计依据。
- [Scoring](../scoring/README.md) —— 值断言、作用域断言、judge、严重度与判定规则。
- [Agents 与 Adapters](../adapters/README.md) —— agent 三类 transport 与 agent 适配。
- [Experiments](../experiments/README.md) —— eval 由谁跑、跑几次、对着哪个 agent。
