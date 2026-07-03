# Origin 应用接入手册

这份文档是**工单**:`examples/zh/origin/` 下有五个还没接 niceeval 的独立应用,本文按应用逐个说明怎么把它们接进来。读者是执行接入的 agent——照着做就能完成,不需要再读一遍全部设计文档。

先记住三条铁律:

1. **不改 origin 的任何文件。** 接入产物放 `examples/zh/eval/<同名>/`:从 origin 复制整个应用,被复制的文件保持逐字节不变,接入代码全部是**新增**文件。`pnpm run gen:diff-code` 会 diff origin 和 eval 两个目录生成 before/after 文档页,"应用侧零改动"是这些页面的核心卖点,改一个字节都会破坏它。
2. **协议以实际输出为准。** 动手写映射之前,先把应用跑起来,`curl -N` 打一轮 `/api/chat` 把 SSE 帧看一遍。本文的帧格式描述来自当前代码,但代码会演化,别背文档。
3. **不要用 `otelEvents()`。** `docs-site/zh/guides/connect-otel.mdx` 里描述的 `events: otelEvents()` 是设计提案([otel-mixin](adapters/otel-mixin.md)),**还没实现**,`niceeval/adapter` 里没有这个导出。工具断言一律走手写帧映射;trace 瀑布图走已实现的 `capabilities.tracing` + `tracing.env`(见下)。

## Tier 是什么,这次做到哪一档

接入分两档(定义见 [Concepts · 接入 Tier](concepts.md#被测对象与适配器)):

- **Tier 1(无侵入)**:应用代码一行不改,adapter 适配应用现有的 HTTP 接口。买到:观测类断言(工具调用、事件流、trace 瀑布、用量成本)+ **模型对比** experiment。
- **Tier 2(侵入)**:改应用内部代码,把 prompt、工具集、feature 开关暴露成外部可选配置,解锁**完整的 feature A/B test** experiment。

**本工单只做 Tier 1。** Tier 2 的建议改法在文末列出,但那是单独的工作,不要顺手做。

## 统一的接入配方

五个应用的形态高度一致(HTTP 服务 + SSE 流式响应),所以 adapter 的骨架也一致。差异只在:帧格式怎么翻、session 字段叫什么、有没有审批流、OTel 有没有 span。

### 目录布局

```text
examples/zh/eval/<name>/
├── (origin 的完整副本,逐字节不变)
├── package.json            在副本基础上加 niceeval devDependency(这算"修改",diff 页会如实展示,允许)
├── niceeval.config.ts      新增
├── agents/
│   ├── <name>.ts           新增:adapter 本体
│   └── server-lifecycle.ts 新增:拉起/健康检查/关闭应用子进程
├── evals/*.eval.ts         新增
└── experiments/*.ts        新增
```

对照现成的 `examples/zh/eval/claude-sdk/` 看布局即可——但**不要照抄它的 adapter**:它接的是 origin 的旧 JSON 快照,origin 已经改成 SSE 透传,这正是本次要重做的(见文末「现状」)。

### adapter 骨架

adapter 的 `send` 每轮做五件事,按顺序:

```ts
// agents/<name>.ts
import { defineAgent } from "niceeval/adapter";
import { ensureServer } from "./server-lifecycle.ts";

export default defineAgent({
  name: "<name>",
  capabilities: {
    conversation: true,        // 做完 session 写回后声明
    toolObservability: true,   // 确认映射覆盖全部工具帧后声明
    tracing: true,             // 仅 ai-sdk-v7 / codex-sdk / langgraph(有 span 的)声明
  },
  tracing: {
    // 仅声明 tracing 的应用需要。endpoint 是 niceeval 接收器的完整路径(…/v1/traces),
    // 各应用要的环境变量形态不同,见各应用小节。
    env: (endpoint) => ({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint.replace(/\/v1\/traces$/, "") }),
  },
  async send(input, ctx) {
    // 1. 确保应用子进程活着(首次调用时拉起;模型、OTel env 都在这里注入)
    const server = await ensureServer({ model: ctx.model, telemetryEnv: ctx.telemetry?.env });

    // 2. 发请求。session 续接:isNew 时不带 id,拿到应用回的 id 后写回 ctx.session.id
    const res = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: input.text,
        sessionId: ctx.session.isNew ? undefined : ctx.session.id,
      }),
      signal: ctx.signal,
    });

    // 3. 逐帧读 SSE,把应用的原生帧翻成 StreamEvent(映射表见各应用小节)
    // 4. 碰到审批帧 → 返回 status:"waiting"(HITL,见下节)
    // 5. 流正常结束 → 返回 status:"completed" + events + usage
  },
});
```

SSE 读法是标准的:`res.body` 按行切,`data: ` 前缀后面是一帧 JSON,空行分隔。写一个 `async function* readSseFrames(res)` 生成器,五个 adapter 共用思路(langgraph/pi 的自定义帧、claude 的 SDKMessage、codex 的 ThreadEvent 都是这一种传输)。

事件词汇表(`message` / `action.called` / `action.result` / `input.requested` …)见 [docs-site 事件流参考](../docs-site/zh/reference/events.mdx)。映射三要点:按真实顺序、`callId` 配对、不漏帧——漏了就别声明 `toolObservability`。

### server 生命周期

- adapter 模块内维护一个单例 promise:首次 `send` 时 spawn 应用(命令见各应用小节),轮询 `GET /healthz` 直到 200,超时(建议 30s)就报错并把子进程 stderr 带进错误信息。
- **端口每实例现挑一个空闲的**,经 `PORT` 环境变量注入(五个应用都支持)。写死默认端口会在实验组并行时撞车。
- `ctx.model` 经 `AGENT_MODEL` 环境变量注入(ai-sdk-v7 例外,它走请求体,见其小节)。这就是 Tier 1 模型对比的全部实现:一个 experiment 一个 model,adapter 实例各拉各的 server。
- `ctx.telemetry?.env` 原样 spread 进子进程环境(声明了 `tracing` 的应用)。
- 进程退出时把子进程杀干净(`process.on("exit")` + unref 不够时用 signal 转发)。

### HITL:审批流怎么接

这是唯一不显然的部分,先理解应用侧的机制:**应用在等审批时,SSE 流保持打开**——服务端把执行卡在一个 Promise/队列上,审批决定走**另一个** `POST /api/chat/approve` 请求,resolve 之后原来那条 SSE 继续吐帧直到结束。

所以 adapter 要这样做:

1. `send` 读流,读到审批帧(各应用帧名见小节)时**不要关流**——把「读了一半的流 + 审批 id」存进模块级 Map(key 用 `ctx.session.id`),返回:

   ```ts
   return {
     status: "waiting",
     events: [...已翻译的事件, {
       type: "input.requested",
       request: { id: 审批id, action: 工具名, input: 工具入参,
                  options: [{ id: "approve" }, { id: "deny" }] },
     }],
   };
   ```

2. 下一次 `send`(就是 eval 里的 `t.respond("approve"/"deny")`)先查 Map:有挂起的流,就 `POST /api/chat/approve`(body 字段名各应用不同!claude/pi 是 `toolUseId`,langgraph 是 `toolCallId`),然后**继续读原来那条流**到结束,把剩余帧作为这一轮的 events 返回。
3. 拒绝(`deny`)时,把被拒工具的 `action.result` 的 `status` 置 `"rejected"`,不是 `"failed"`。

没有审批流的应用(codex-sdk)跳过这一整节,永远不返回 `waiting`。

### OTel:四种状况,四种解法

应用的 OTel 埋点状况不一样,解法也不一样——**先对号入座,再写 adapter 的 tracing 部分**。共同前提再强调一次:今天 OTel 在 Tier 1 里只买到 **trace 瀑布图**(`niceeval view` 里看每轮耗时、模型/工具调用嵌套);**事件断言的数据源五个应用全部是 SSE 帧映射**,和 OTel 无关。

| 状况 | 应用 | 解法 |
|---|---|---|
| **A. 标准方言 spans**(GenAI semconv / LangSmith 等已识别格式) | ai-sdk-v7、langgraph | 声明 `capabilities.tracing`,`tracing.env` 注入端点,瀑布图直接有。这是最顺的一档。 |
| **B. 自家方言 spans** | codex-sdk | 同 A 的写法;niceeval 接收器已内置 codex 的 span mapper(`src/o11y/otlp/mappers/codex.ts`),瀑布图能画。但 codex span 里没有工具入参出参,别指望从 span 断言工具 I/O。 |
| **C. 只有 metrics + logs,没有 spans** | claude-sdk | OTel 帮不上——niceeval 只消费 trace spans。**不声明 `tracing`**,不注入 OTel env(注入了也只是白发 metrics),在 eval README 写明"此应用无瀑布图"。 |
| **D. 完全没有 OTel** | pi-sdk | 同 C:不声明,全靠 SSE。想要瀑布图属于 Tier 2(进程内按 GenAI semconv 埋点,埋完升级到 A 档),本工单不做。 |

A/B 两档的 adapter 差异只剩端点形态和附加开关,汇总一处免得翻小节:

- **ai-sdk-v7 / codex-sdk**:`OTEL_EXPORTER_OTLP_ENDPOINT` 传 **base**(把 `ctx.telemetry` 端点的 `/v1/traces` 尾巴去掉,应用自己拼);
- **langgraph**:传**完整路径**(保留 `/v1/traces`),并同时注入 `LANGSMITH_TRACING=true`、`LANGSMITH_OTEL_ENABLED=true`、`LANGSMITH_OTEL_ONLY=true` 三个开关。

将来 `otelEvents()` 落地后,A 档(以及暴露了 mapper 的 B 档)的事件断言也能从 span 派生,SSE 退化成纯收发——但那是框架侧的工作,不在本工单里,也不要提前按那个 API 写。

## 各应用速查

| | 端口 | 请求体 | 帧格式 | session 字段 | HITL | 模型选择 | OTel spans |
|---|---|---|---|---|---|---|---|
| ai-sdk-v7 | 5188 | `{messages[], model}` | AI SDK UI Message Stream | 无(整份 messages 重放) | 流内(SDK 机制) | 请求体 `model` | ✅ GenAI 语义 |
| claude-sdk | 5189 | `{message, sessionId}` | SDKMessage 原样透传 | `sessionId`(SDK 落盘) | `/api/chat/approve` `toolUseId` | env `AGENT_MODEL` | ❌ 只有 metrics+logs |
| codex-sdk | 5199 | `{message, threadId}` | ThreadEvent 原样透传 | `threadId`(SDK 落盘) | 无 | env `AGENT_MODEL` | ✅ codex 自家 span |
| pi-sdk | 5299 | `{message, sessionId}` | AgentEvent 透传 + 3 种自定义帧 | `sessionId`(服务端内存) | `/api/chat/approve` `toolUseId` | env `AGENT_MODEL` | ❌ 无 |
| langgraph | 5488 | `{message, sessionId}` | 自定义 JSON 帧 | `sessionId` = thread_id(进程内存) | `/api/chat/approve` `toolCallId` | env `AGENT_MODEL` | ✅ LangSmith OTel |

启动命令、必需的 key 见各 origin 目录的 `.env.example` 和 [origin README](../examples/zh/origin/README.md)。下面只写映射和陷阱。

### ai-sdk-v7

- 启动:`node --env-file .env --import tsx/esm src/backend/server.ts`,健康检查 `/healthz`。
- **session 是客户端全量重放**:adapter 用「客户端带全量历史」模式——模块级 `Map<sessionId, UIMessage[]>`,每轮把用户消息 push 进去、整份 `messages` 发过去、把流里拼出来的 assistant 消息 push 回来。`ctx.session.isNew` 时 `crypto.randomUUID()` 当 key。
- 帧映射(UI Message Stream chunk):`text-delta` 累积成一条 `message`;`tool-input-available` → `action.called`;`tool-output-available` → `action.result`;审批请求 chunk → `input.requested` + `waiting`(注意:这个应用的审批回复走**下一次 `/api/chat` 请求的 messages 里**,不是 approve 端点——把审批响应 part 塞进重放的 messages,具体 part 形状先打帧确认)。
- 模型对比:请求体 `model` 字段,`ctx.model` 直接透传,server 不用重启。可选值看 `GET /api/models`。
- tracing:`tracing.env` 给 `OTEL_EXPORTER_OTLP_ENDPOINT`(**去掉** `/v1/traces` 尾巴,应用自己拼)。坑:应用用 `BatchSpanProcessor`,span 可能晚到几秒——瀑布图偶发缺尾巴是这个原因,Tier 1 不改代码只能接受,记进 eval README 即可。
- 备注:仓库里已有进程内直调的 `examples/zh/eval/ai-sdk-v7`(用内建 `aiSdkAgent`)。本工单做的是**对着 HTTP 接口的黑盒接入**,是另一个东西,不要覆盖已有目录——产出放 `eval/ai-sdk-v7-http/`(唯一一个不同名的,README 里写清原因)。

### claude-sdk

- 帧是原生 `SDKMessage`:`system`(subtype init,带 `session_id`,**写回 `ctx.session.id`**)→ `assistant`(content blocks:`text` → `message`,`tool_use` → `action.called`)→ `user`(`tool_result` → `action.result`,按 `tool_use_id` 配对)→ `result`(终局,带 usage/cost → `usage`)。`stream_event` 帧是逐 token 渲染用的,**整个忽略**。
- **HITL 没有显式的"等审批"帧**——`canUseTool` 把流卡住,客户端只能从"`calculate` 的 `tool_use` 到了、之后没动静"推断。Tier 1 的确定性做法:被门控的工具就 `mcp__demo-tools__calculate` 一个(写在 `agent.ts` 里),adapter 见到它的 `tool_use` 帧就直接按审批点处理(挂流、返回 `waiting`,审批 id = `tool_use` 块的 `id`)。把这个"adapter 里硬编码了门控工具名"写进代码注释和 eval README。
- 无 trace spans(CLI 原生遥测只有 metrics+logs,niceeval 不消费),**不声明 `tracing`**,瀑布图这个应用没有——这不是你的失误,写进 README。
- 模型:`AGENT_MODEL` 注入子进程(代码默认 `deepseek-v4-flash`,`.env.example` 是 `claude-sonnet-5`,以 `.env.example` 为准)。

### codex-sdk

- 帧是原生 `ThreadEvent`:`thread.started` 带 `thread_id`(写回 session)→ `item.*` 系列(`agent_message` item → `message`;`command_execution` / `file_change` / `mcp_tool_call` item → `action.called` + `action.result`,状态从 item 的完成态取)→ `turn.completed`(带 usage)/ `turn.failed` / `error`(→ `failed`)。
- 无 HITL,永不返回 `waiting`。它是编码 agent,eval 应该测「在工作目录里写文件、跑命令」这类真实任务(现有 `eval/codex-sdk` 的 eval 思路可参考,adapter 要按 SSE 重写)。
- tracing:声明。`tracing.env` 给 `OTEL_EXPORTER_OTLP_ENDPOINT`(去掉 `/v1/traces` 尾巴,codex 配置里自己拼)。codex 的 span 是自家命名,niceeval 接收器已认识(`src/o11y/otlp/mappers/codex.ts`),瀑布图能画;但 span 里没有工具入参出参,**工具断言的数据来源仍是 SSE 帧,不是 span**。
- 模型:`AGENT_MODEL`(默认 `gpt-5.4`),自定义 provider 走 `CODEX_BASE_URL`。

### pi-sdk

- **这是唯一从零开始的**(没有 eval/ 目录),也是手写映射路线最完整的示范:无 OTel、有 HITL、服务端内存 session。做完它,顺手把 `examples/zh/eval/custom-genai/` 删掉(历史残留,origin 侧早已改名重写)。
- 帧 = 原生 `AgentEvent` + 三种自定义帧。自定义帧:`{type:"session", sessionId}`(第一帧,写回 session)、`{type:"approval_request", toolCallId, toolName, args}`(→ `input.requested` + `waiting`)、`{type:"server_error", message}`(→ `failed`)。原生帧:`message_update` 累积文本 → `message`;`tool_execution_start` → `action.called`;`tool_execution_end` → `action.result`。
- HITL 走标准配方,approve 端点字段 `toolUseId`。
- session 在服务端内存里,**attempt 之间不要重启 server**,重启即丢会话;这也是为什么生命周期要做成"整个 adapter 进程一个 server 单例"。
- 无 OTel,不声明 `tracing`。模型:`AGENT_MODEL`,只有 `deepseek-v4-flash` / `deepseek-v4-pro` 两个可选。

### langgraph

- 唯一的 Python 应用:启动是 `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python src/backend/server.py`,生命周期代码里要处理 venv 不存在时先建(或在 README 里要求手工建好,报错时直说"先建 venv")。
- 帧全是自定义 JSON,映射最直白:`session` → 写回;`text-delta` 累积 → `message`;`tool-input` → `action.called`;`tool-output` → `action.result`;`tool-approval-request` → `input.requested` + `waiting`;`tool-output-denied` → `action.result`(`status:"rejected"`);`error` → `failed`;`finish` → 一轮结束哨兵。
- HITL 标准配方,**approve 端点字段是 `toolCallId`**(别照抄 claude/pi 的 `toolUseId`)。
- tracing:声明。注意 **langgraph 要的是完整路径**:`tracing.env` 给 `OTEL_EXPORTER_OTLP_ENDPOINT` 时**保留** `/v1/traces` 尾巴(和 ai-sdk/codex 相反)。另外三个 LangSmith 开关(`LANGSMITH_TRACING` / `LANGSMITH_OTEL_ENABLED` / `LANGSMITH_OTEL_ONLY`)一起注入。
- session 是 `InMemorySaver`,同 pi:server 不要中途重启。
- 现有 `eval/langgraph` 已存在,核对它的 adapter 是否对着当前帧协议,过时就按本手册重写。

## 每个应用要写的 eval(最低集合)

1. **基础问答**:`t.send` 一轮,`t.succeeded()` + 文本断言。
2. **工具调用**:触发 `get_weather` 之类,`t.calledTool` / `t.toolOrder` / `t.noFailedActions`。
3. **多轮记忆 + 隔离**:第一轮报名字、第二轮问名字;`t.newSession()` 再问,新会话不应知道——这条专门验证 session 写回没写错(最常见 bug:忽略 `isNew` 一律续接,隔离静默失真)。
4. **HITL 批准 + 拒绝**(有审批流的应用):`waiting` → `respond("approve")` → `calledTool(..., {status:"completed"})`;拒绝分支断 `status:"rejected"`。
5. **用量/成本**(能拿到 usage 的应用):`t.maxTokens` 冒烟。

experiment 至少两个:单配置基线 + 一个 `compare-models/` 实验组(ai-sdk-v7 / claude-sdk / pi-sdk 有多模型可比)。

## 验收清单(每个应用)

- [ ] `git status` 确认 origin 目录零改动;eval 目录里被复制的应用文件与 origin 逐字节一致
- [ ] `pnpm run typecheck` 通过
- [ ] `npx niceeval exp <基线>` 全绿;`npx niceeval view` 里事件流完整(message + action 配对)
- [ ] 多轮记忆和 newSession 隔离两条 eval 都过
- [ ] 有 HITL 的:approve / deny 两条都过,deny 的工具结果是 `rejected` 不是 `failed`
- [ ] 声明了 `tracing` 的:view 瀑布图非空
- [ ] 声明的每个能力位都有对应 eval 实证;做不到的能力**不声明**,并在 eval README 写明原因(如 claude-sdk 无 span)

## Tier 2 备忘(本工单不做)

将来要做 feature A/B test 时,每个应用的最小侵入点(原则:加环境变量/请求字段开关,默认行为不变):

- ai-sdk-v7:system prompt、工具集做成请求体可选字段;
- claude-sdk:`allowedTools`、system prompt 提升为环境变量;
- codex-sdk:`threadOptions`(sandbox mode 等)提升为环境变量;
- pi-sdk:system prompt / 注册工具集提升为环境变量;
- langgraph:`HumanInTheLoopMiddleware` 开关、prompt 提升为环境变量。

experiment 侧用 `flags` → `ctx.flags` 透传,写法见 [Experiments](experiments.md)。

## 现状(2026-07,做之前核对)

- `otelEvents()` 未实现(见铁律 3)。
- `eval/claude-sdk`、`eval/codex-sdk`、`eval/langgraph` 已存在但接的是 origin 的**旧接口快照**(origin 已改为 SSE 原生流透传),adapter 需按本手册重写,应用副本需从当前 origin 重新复制。
- `eval/custom-genai` 是残留,pi-sdk 接完后删除。
- `eval/pi-sdk` 不存在,从零建。
- 三个 before/after 文档页(claude-sdk / codex-sdk / langgraph)还没挂进 `docs-site/docs.json` 导航;eval 重接完成后重跑 `pnpm run gen:diff-code` 再挂导航。
