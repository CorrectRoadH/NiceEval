# E2E CI(设计提案,未实现)

> 状态:设计提案。本文描述 niceeval 的端到端 CI 测试方案——用真实的 `niceeval exp` 全链路(发现 → 调度 → 断言 → 评分 → 工件 → 退出码)验证框架和官方适配器,而不是只跑 typecheck。当前 `.github/workflows/ci.yml` 只有 typecheck / site:build / docs 校验,没有任何 workflow 真正执行过 eval。

## 1. 目标

一次 e2e CI 要同时证明四件事:

1. **完整路径**:从 `evals/` 发现、experiment 展开运行矩阵、`t.*` 断言收集、gate/soft 判决、`.niceeval/<run>/` 工件落盘,到进程退出码,每一环都被真实执行并被机器校验——包括"该红的时候红"(deliberate-fail 必须 exit 1),不是只测 happy path。
2. **重复运行统计**:一个 experiment 配 `runs: 100, earlyExit: false`,验证 100 次重复的调度、并发、pass 率计数正确(niceeval 的字段就叫 `runs`,不叫 pass/trials;`earlyExit` 不关掉的话第一次通过就会 abort 其余 attempt,拿不到完整分布)。
3. **正反断言**:同一个 agent 下,一条 eval 断言必须调工具(`t.calledTool`),另一条断言不该调工具(`t.notCalledTool` / `t.usedNoTools`),两边都以 gate 生效——防止"断言永真"这类静默失效。
4. **官方适配器矩阵**:内置的 claude-code / codex / bub(沙箱型)、`uiMessageStreamAgent` / `fromAiSdk`(HTTP)、自写 `defineAgent`(remote HTTP),以及沙箱后端 docker / vercel / e2b,每条官方路径至少有一条 CI 覆盖。

## 2. 现状盘点

### examples/zh 能直接复用什么

| 示例 | 接入路径 | 有 evals/experiments | 对 e2e 的价值 |
|---|---|---|---|
| `ai-sdk` | 自写 remote HTTP adapter(`defineAgent`) | 是(5 evals × 2 组 exp) | 覆盖"自写 adapter"路径;server 有 `AGENT_MODE=mock`,可零 key 跑 |
| `tier1/ai-sdk-v7` | 内建 `uiMessageStreamAgent`(HTTP,无侵入) | 是(6 evals,含唯一完整的正反 tool-call 断言 + HITL approve/deny) | 覆盖官方 HTTP 适配器;应用需真实起服务、连真模型,需 key |
| `coding-agent-skill` | `claudeCodeAgent()` + `dockerSandbox()` | 是(5 沙箱 evals × 4 组 A/B exp) | 覆盖沙箱型适配器 + docker 后端;需 `ANTHROPIC_API_KEY` + Docker |
| `tier1/{claude-sdk,codex-sdk,pi-sdk,langgraph}` | 自写/官方转换器 HTTP adapter,见 [origin-integration.md](origin-integration.md) | 是 | 覆盖官方转换器(`fromClaudeSdkMessages` / `fromPiAgentEvents` / `fromCodexThreadEvents`)与 OTel 瀑布图(非断言)路径;应用需真实起服务,部分需 key |

### 框架侧对 CI 重要的事实(源码已确认)

- **退出码**:全过/跳过 → 0;任一 failed 或 errored → 1;框架崩溃 → 2(`src/cli.ts:414`)。CI 判成败首选退出码,细分读 `summary.json`。
- **指纹缓存会静默跳过上次 passed 的 eval**(`src/runner/run.ts:117-135`)。CI 必须加 `--force`,或保证 `.niceeval/` 不跨 run 复用,否则回归会被缓存掩盖。
- **judge 无 key 时 no-op**(`src/scoring/judge.ts:162`):不配 judge key,`t.judge.autoevals.*` 断言静默跳过、不判红。mock 层利用这一点零 key 跑;"judge 真的在判"要单独在有 key 的层验证。
- **可用 flags**:`--runs`、`--no-early-exit`、`--force`、`--junit <path>`、`--strict`、`--max-concurrency`。**不要用** `--json`(死 flag)、`--reporter`(不存在)、`--agent`/`--model`(exp 下报错)、`--sandbox`(已移除)。
- **`runs` 的语义**:每个 `(agent × model × eval)` 组合跑 `runs` 次;被 earlyExit abort 的 attempt 不计入分母。

## 3. 总体设计:三层

按"需要什么秘密、花多少钱、多久跑一次"分三层,层与层的 fixture 和 workflow job 分开:

| 层 | 触发 | 秘密/外部依赖 | 验证什么 |
|---|---|---|---|
| **L0 框架路径层**(mock) | 每个 PR + push main | 无 | 完整路径 + 正反断言 + `runs: 100` 统计 + 退出码语义 + 缓存行为。全部走确定性 mock,免费、分钟级 |
| **L1 示例冒烟层**(mock) | 每个 PR + push main | 无 | `examples/zh/ai-sdk` 在 `AGENT_MODE=mock` 下真的能 `niceeval exp` 跑绿——保证公开示例不烂 |
| **L2 真实适配器层** | nightly cron + 手动 dispatch | `ANTHROPIC_API_KEY` / `CODEX_API_KEY` / `BUB_API_KEY` / `E2B_API_KEY` / Vercel token;Docker | claude-code / codex / bub × docker / e2b / vercel 的官方组合各跑最小 smoke;judge 有 key 时真的产生分数 |

L0/L1 是合并门禁;L2 是每日健康信号(真模型有随机性,不阻塞 PR)。

## 4. L0:框架路径层(新增 `e2e/` fixture 项目)

deliberate-fail、deliberate-error 这类"故意红"的 eval 不适合放进用户可见的 `examples/`,所以 L0 用一个专门的 fixture 项目,建议放 `e2e/`(与 `examples/`、`src/` 平级):

```text
e2e/
  niceeval.config.ts
  agents/
    mock-ai-sdk.ts           # defineAgent + fromAiSdk,消费一个返回 AI SDK 结果形状 JSON 的本地 mock server(官方转换器路径)
    mock-http.ts              # defineAgent + 手写映射,消费一个自定义 JSON 协议的本地 mock server(自写 remote 路径)
  evals/
    tool-positive.eval.ts    # 正调:必须 calledTool
    tool-negative.eval.ts    # 反调:必须 notCalledTool / usedNoTools
    multi-turn.eval.ts       # 会话记忆 + newSession 隔离
    deliberate-fail.eval.ts  # gate 断言必挂 → 框架必须判 failed
    deliberate-error.eval.ts # test() 抛异常 → 框架必须判 errored
  experiments/
    pass-100.ts              # runs: 100, earlyExit: false
    verdicts.ts              # 只跑 deliberate-*,期望 exit 1
    http-agent.ts            # 走 mock-http adapter,同一批正反 eval
  scripts/
    verify.mjs               # 元校验:跑 CLI 子进程,对照期望表检查退出码 + summary.json
```

### 4.1 确定性 mock agent(HTTP,走官方 `fromAiSdk` 转换器路径)

mock 的规则要足够简单以保证 100 次重复全部同构:提示词含"天气"就走一次 `get_weather` 工具调用,否则纯文本作答。verify.mjs 起一个本地 mock HTTP server,`/chat` 接口返回一个贴近 AI SDK `generateText` 结果形状的 JSON(`fromAiSdk` 认可的形状子集,见 `src/agents/ai-sdk.ts`,它不 import `ai` 包、只认形状);adapter 照常 `fetch` 这个接口,拿到响应后用 `fromAiSdk` 转成标准事件流,不手写映射:

```typescript
// e2e/agents/mock-ai-sdk.ts
import { defineAgent, fromAiSdk } from "niceeval/adapter";

const MOCK_URL = process.env.E2E_MOCK_AI_SDK_URL ?? "http://127.0.0.1:5900";

export default defineAgent({
  name: "e2e-mock-ai-sdk",
  async send(input, ctx) {
    const r = await fetch(`${MOCK_URL}/chat`, {
      method: "POST",
      body: JSON.stringify({ prompt: input.text }),
      signal: ctx.signal,
    });
    const result = await r.json();   // mock server 按提示词规则返回贴近 AI SDK 结果形状的 JSON
    return { ...fromAiSdk(result), data: result.text };
  },
});
```

```typescript
// e2e/scripts/mock-ai-sdk-server.mjs(verify.mjs 启动的本地 mock server,示意)
function mockGenerate(prompt) {
  if (prompt.includes("天气")) {
    return {
      text: "北京今天晴,25°C。",
      toolCalls: [{ toolCallId: "call_1", toolName: "get_weather", input: { city: "北京" } }],
      toolResults: [{ toolCallId: "call_1", toolName: "get_weather", output: { temp: 25 } }],
    };
  }
  return { text: "你好,我是一个演示助手。", toolCalls: [], toolResults: [] };
}
```

这条路径的价值:虽然模型是假的,但 `fromAiSdk` 的字段兜底、事件流生成、断言评估、工件落盘全是真的——这正是 e2e 要测的东西。

### 4.2 正反断言对

```typescript
// e2e/evals/tool-positive.eval.ts
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "问天气必须调用 get_weather(正调)",
  async test(t) {
    await t.send("北京今天天气怎么样?");
    t.succeeded();
    t.calledTool("get_weather", { input: { city: "北京" } });
    t.notCalledTool("send_email");
    t.check(t.reply, includes("25"));
  },
});
```

```typescript
// e2e/evals/tool-negative.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "寒暄不该调用任何工具(反调)",
  async test(t) {
    await t.send("你好,介绍一下你自己。");
    t.succeeded();
    t.usedNoTools();
    t.notCalledTool("get_weather");
  },
});
```

### 4.3 100 次重复的 experiment

```typescript
// e2e/experiments/pass-100.ts
import { defineExperiment } from "niceeval";
import mockAiSdk from "../agents/mock-ai-sdk";

export default defineExperiment({
  description: "100 次重复,验证调度与 pass 率计数",
  agent: mockAiSdk,
  runs: 100,
  earlyExit: false,          // 必须关,否则第一次通过就 abort 其余 99 次
  maxConcurrency: 16,
  evals: ["tool-positive", "tool-negative"],
});
```

mock 是确定性的,所以期望值是精确的:`passed === 200, failed === 0, errored === 0`。元校验脚本按这个断言,任何一次计数不对都说明调度/评分/汇总有回归。

### 4.4 元校验脚本(e2e 的"真正的测试")

L0 的本体不是那些 eval——eval 是 fixture;本体是 `verify.mjs`:它把 CLI 当黑盒子进程跑,对照期望表校验退出码和 `summary.json`:

```javascript
// e2e/scripts/verify.mjs(示意)
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const CASES = [
  { exp: "pass-100",  extraArgs: [], expectExit: 0, expect: { passed: 200, failed: 0, errored: 0 } },
  { exp: "verdicts",  extraArgs: [], expectExit: 1, expect: { failedAtLeast: 100, erroredAtLeast: 100 } },
  { exp: "http-agent", extraArgs: [], expectExit: 0, expect: { failed: 0, errored: 0 } },
];

for (const c of CASES) {
  const code = runNiceeval(["exp", c.exp, "--force", "--junit", `junit-${c.exp}.xml`, ...c.extraArgs]);
  assert.equal(code, c.expectExit, `${c.exp} 退出码`);
  const summary = JSON.parse(readFileSync(latestRunDir() + "/summary.json", "utf8"));
  assertCounts(summary, c.expect);
}
```

verify.mjs 还负责两个专项:

- **缓存行为**:同一 experiment 连跑两次,第二次**不带** `--force` → 断言 summary 里携入的 cached 结果仍计为 passed 且没有真跑(比较 `durationMs` 或 attempt 工件时间戳);第二次**带** `--force` → 断言全部真跑。这把"CI 忘了 --force 会静默跳过"的坑变成被测行为。
- **工件形状**:抽查一个 attempt 目录,断言 `events.json` 是 JSON array、`summary.json` 顶层有 `passed/failed/errored/results[]`、`results[].artifactsDir` 指向存在的目录。防止 results-format 无声漂移(当前 writer 没有 schemaVersion,只能靠这层守)。

### 4.5 mock HTTP agent(自写 remote 路径)

`e2e/agents/mock-http.ts` 用 `defineAgent` 写一个最小 remote adapter,指向 verify.mjs 启动的本地 mock server(逻辑同 4.1 的规则)。它和进程内 mock 跑同一批正反 eval,保证"自写 adapter"契约(`send` 进 / `Turn` 出、事件映射)这条官方路径也被覆盖。实现可以直接参照 `examples/zh/ai-sdk/adapter/adapter.ts` 裁剪。

## 5. L1:示例冒烟层

目的只有一个:公开示例必须能按 README 跑通。首选 `examples/zh/ai-sdk`,因为它的 server 有零 key 的 `AGENT_MODE=mock`:

```yaml
# job 示意
- run: pnpm install --dir examples/zh/ai-sdk
- run: AGENT_MODE=mock node server &   # 起 127.0.0.1:5188,等端口就绪
- run: pnpm exec niceeval list         # eval 发现冒烟
- run: pnpm exec niceeval exp compare-models --runs 1 --force --junit junit.xml
```

验收前提(落地时先确认,不满足就先修示例的 mock):mock 模式下 `weather-tool` 等 gate 断言必须可过——即 mock server 对天气提问要真的产生 `get_weather` 工具调用事件。judge 断言无 key 自动跳过,正好符合本层"零秘密"的定位。

`ai-sdk-v7` 的 `generate` 直连真模型、没有 mock 开关,进 L2;如果后续给它加 `AGENT_MODE=mock` 的 generate 分支,可以升到 L1(它的正反断言和 HITL approve/deny 是全仓库最全的,很值得每 PR 跑)。

## 6. L2:真实适配器层(nightly)

覆盖矩阵按"官方适配器 × 沙箱后端"取最小生成集,不做全叉乘:

| Job | agent | sandbox | 秘密 | eval 集 |
|---|---|---|---|---|
| claude-code × docker | `claudeCodeAgent()` | `dockerSandbox()` | `ANTHROPIC_API_KEY` | `sandbox-smoke` + `examples/zh/coding-agent-skill` 子集(`--runs 1`) |
| codex × docker | `codexAgent()` | `dockerSandbox()` | `CODEX_API_KEY` | `sandbox-smoke`;额外断言 `trace.json` 产生(codex 是唯一原生发 OTLP 的内置 agent,顺带覆盖 tracing 接收链路) |
| bub × docker | `bubAgent()` | `dockerSandbox()` | `BUB_API_KEY` | `sandbox-smoke` |
| claude-code × e2b | `claudeCodeAgent()` | `e2bSandbox({ template: "fasteval-agents" })` | `ANTHROPIC_API_KEY` + `E2B_API_KEY` | `sandbox-smoke` |
| claude-code × vercel | `claudeCodeAgent()` | `vercelSandbox()` | `ANTHROPIC_API_KEY` + Vercel token | `sandbox-smoke`(注意 vercel session 寿命 ~360s 上限,eval 要够小) |
| `uiMessageStreamAgent` 真模型 + judge | `examples/zh/tier1/ai-sdk-v7` | — | 模型 key + judge key | 全部 6 条 eval,`--runs 2`;有 judge key,顺带验证 judge 断言真的产出分数而非 no-op |

`sandbox-smoke` 是一条新的最小沙箱 eval(放 `e2e/evals/`):让 agent 创建一个指定内容的文件,断言 `t.sandbox.fileChanged` + `diff` 内容——目标是验证"沙箱起得来、agent 装得上、transcript 读得回",不是考模型能力,所以提示词要简单到几乎不可能失败。

已知约束(来自项目 memory,落地时直接采纳):e2b 的 `base` 模板 node20/481MB 会 OOM,必须用预制的 `fasteval-agents` 模板;vercel 后端默认并发 1(避免 429),session 上限约 360s;沙箱内不要 hardcode `/home/node`。

L2 每个 experiment 都设 `budget`(建议单 job ≤ $2)和 `timeoutMs`,workflow 层再加 job timeout 兜底。真模型 eval 允许波动:L2 失败发通知(GitHub issue / 通知渠道)而不是标红 main。

## 7. Workflow 编排

新增 `.github/workflows/e2e.yml`:

```yaml
on:
  push: { branches: [main] }
  pull_request:
  schedule: [{ cron: "0 3 * * *" }]   # L2 nightly
  workflow_dispatch:

jobs:
  e2e-framework:      # L0,PR 门禁
    runs-on: ubuntu-latest
    steps: [checkout, pnpm install, node e2e/scripts/verify.mjs]

  e2e-examples:       # L1,PR 门禁
    runs-on: ubuntu-latest
    # 见第 5 节

  e2e-adapters:       # L2,仅 schedule / dispatch
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    strategy: { fail-fast: false, matrix: { target: [claude-docker, codex-docker, bub-docker, claude-e2b, claude-vercel, ai-sdk-v7-real] } }
    runs-on: ubuntu-latest   # ubuntu runner 自带 Docker
```

所有 job 统一约定:

- 每次调用 `niceeval exp` 都带 `--force`(禁指纹缓存)+ `--junit <path>`;junit 和整个 `.niceeval/` 目录用 `actions/upload-artifact` 上传,失败时可下载 `events.json` / `trace.json` 排查。
- 成败判据 = 进程退出码;verify.mjs 层再做计数级校验。
- L0/L1 不配置任何 API key secret——judge 断言 no-op 是预期行为,一旦某个 mock 层 job 意外需要 key,说明 fixture 写错了。

## 8. 分阶段落地

1. **P1(先立骨架)**:建 `e2e/` fixture(mock-ai-sdk + 正反 eval + deliberate-fail/error + pass-100 + verify.mjs),加 `e2e-framework` job 进 PR 门禁。这一步零外部依赖,收益最大——完整路径、正反断言、100 次统计、退出码、缓存行为全部落网。
2. **P2**:确认/修好 `examples/zh/ai-sdk` 的 mock 模式可过 gate 断言,加 `e2e-examples` job。
3. **P3**:补 `mock-http` adapter 路径 + `sandbox-smoke` eval;开 L2 的 claude-code × docker(第一条真实沙箱链路)。
4. **P4**:铺满 L2 矩阵(codex / bub / e2b / vercel / ai-sdk-v7 真模型 + judge)。
5. **之后**:`otelEvents()` mixin 落地时,把 openllmetry / openinference / langgraph / custom-genai 四个 demo 接成 L1/L2 的 OTel 断言用例;给 mock 加"确定性失败注入"(如 server 每第 4 次请求返回坏答案)以校验非 0/100 的 pass 率计算。

## 9. 明确不做的

- 不给四个 OTel demo 现在就写 eval——没有方言转换器,写了也只能靠 heuristic 兜底,测不到承诺的行为。
- 不在 PR 门禁里跑任何真模型——随机性 + 费用 + secret 暴露面都不适合。
- 不用 `--tag` 做 CI 内的用例切分(当前实现只收单值,与文档不一致;分层用 experiment 的 `evals` 过滤器表达,更明确)。
- 不依赖 `summary.json` 里的版本字段(writer 尚未写 `schemaVersion`),形状校验只断言当前实际字段。
