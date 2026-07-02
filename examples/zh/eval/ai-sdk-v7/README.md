# AI SDK v7 × 内建适配器示例

这个例子在 [`examples/zh/origin/ai-sdk-v7`](../../origin/ai-sdk-v7/) 的基础上接入 **niceeval 官方
内建的 AI SDK 适配器** `aiSdkAgent`。应用代码(`src/`)几乎不 import 任何 niceeval 的东西:

- `src/ai-sdk-runtime.ts` 把 `streamChat` 里的 streamText 调用拆成独立的 `chat()`——
  **唯一的模型调用点**(model / tools / system prompt / stopWhen 只配一份),只是多收一个
  可选 `opts` 透传取消信号 + telemetry。UI 和 eval 跑的是同一次调用,不存在平行的
  eval 专用路径。另多一个 `send_email` 工具(带 `needsApproval: true`,演示 AI SDK v7
  的 tool approval + niceeval 的 HITL)。
- `src/assistant.ts` 多一个 `sendEmail` 纯函数(`send_email` 工具的实现)。
- `src/models.ts`、`src/server.ts`、`src/client/`、`index.html`、`vite.config.ts` 与
  before/ai-sdk-v7 **逐字节相同**——同一个聊天应用,能不能接 eval 跟这些代码没关系。

eval 侧只声明「怎么召模型」(`generate`)和「结构化输出取什么」(`data`);会话历史、事件流、
HITL 握手、失败兜底、OTel 管线全部由工厂承担。完整代码 diff 见
[ai-sdk 如何接入 NiceEval](../../../docs-site/zh/example/ai-sdk-v7-before-after.mdx)(运行
`pnpm run gen:diff-code` 重新生成),或者直接:

```sh
diff -ru examples/zh/origin/ai-sdk-v7 examples/zh/eval/ai-sdk-v7
```

和隔壁 [`examples/zh/ai-sdk`](../ai-sdk/)(v6,自己写 adapter + 双可观测)是互补关系——那边
演示怎么自己写 adapter,这边演示内建 adapter 怎么接。

> `send_email` 只在 eval 侧(`aiSdkAgent`)有 HITL 握手;网页聊天 UI(`pnpm dev`)用的是
> 普通的 `streamChat`,没有接 approve/deny 界面——手动在聊天里让它发邮件,工具调用会卡在
> 等批准上不会有响应。这是刻意的:UI 只是给人手动试聊天用,HITL 演示走 eval。

## 接线方式

eval 侧的接线全部在 [`experiments/assistant.ts`](experiments/assistant.ts):

```ts
// experiments/assistant.ts
import { aiSdkAgent } from "niceeval/adapter";
import { chat } from "../src/ai-sdk-runtime.ts";

export const assistant = aiSdkAgent<ModelMessage>({
  name: "ai-sdk-v7",
  capabilities: { tracing: true },
  otlpBackendUrl: process.env.OTLP_BACKEND_URL,   // 可选:span 双发到你自己的后端
  // chat() 返回生产同款 streamText 结果;字段是「await 即自动消费流」的 Promise,
  // 聚合成 fromAiSdk 认识的完整结果形状。
  generate: async ({ messages, model, signal, telemetry }) => {
    const stream = chat(messages, model, { signal, telemetry });
    const [text, steps, content, totalUsage, responseMessages] = await Promise.all([
      stream.text, stream.steps, stream.content, stream.totalUsage, stream.responseMessages,
    ]);
    return { text, steps, content, totalUsage, responseMessages };
  },
  data: (result, turn) => ({ reply: result.text ?? "", /* … */ }),
});

// experiments/compare-models/deepseek-v4-pro.ts
export default defineExperiment({
  agent: assistant,
  model: "deepseek-v4-pro",
});
```

`capabilities: { tracing: true }` 声明后,埋点(AI SDK 官方 OTel 集成 `@ai-sdk/otel`)、
per-attempt 端点绑定和轮末 flush 全部由工厂承担——`generate` 只需把收到的 `telemetry`
原样透传给 `streamText`。设 `OTLP_BACKEND_URL` 时,同一批 span 同时双发到你自己的
观测后端(Langfuse / SigNoz / 生产 collector)。

## evals

`evals/` 下每条覆盖一个能力档:结构化输出(`structured-output`)、工具事件流
(`weather-tool`)、多轮会话(`multi-turn`)、HITL 批准/拒绝(`hitl-approve` /
`hitl-deny`)、多模态(`image-understanding`)。具体用了哪些断言看各 eval 源码。

## 跑起来

这个目录是一个**独立的 npm 项目**(自带 `package.json`,`niceeval` 以 link 方式指向仓库根)。

```sh
cd examples/zh/ai-sdk-v7
pnpm install
cp .env.example .env   # 填 DEEPSEEK_API_KEY / OPENAI_API_KEY

pnpm exec niceeval list                              # 列出 eval
pnpm exec niceeval exp compare-models                # 两个模型并排对比
pnpm exec niceeval exp compare-models/deepseek-v4-pro  # 只跑一格
pnpm exec niceeval exp compare-models weather-tool   # 在实验组里只跑某个 eval
pnpm exec niceeval view                              # 本地查看器(trace 瀑布图在这里)
```

也可以像 before/ai-sdk-v7 一样起本地聊天应用(手动试聊天,不跑 eval):

```sh
pnpm dev   # 起 server(5188)+ vite dev server(5173),浏览器打开 5173
```

跨模型对比写**多个实验文件**:`experiments/compare-models/` 下每个文件钉一个 `model`
(`model` 是单个字符串,不接受数组)。

注意:

- `image-understanding` 只在支持视觉的模型上真跑,其余模型 `t.skip`。另有一条环境性
  skip 写在 eval 里(不改应用的模型元数据):设了 `OPENAI_BASE_URL` 时 openai 系模型
  也会跳过,因为自建网关转 Responses API 不认 data URL,传图会被拒("Expected a valid
  URL");直连 OpenAI 或换个支持图像输入的网关后,删掉 eval 里那段 skip 就会真跑。
- 没有 judge API key 时,judge 断言自动跳过,确定性断言照常跑;judge 模型配置在
  `niceeval.config.ts`(默认 `gpt-5.4`,走 `OPENAI_API_KEY`)。
- 这里注册的是 remote(进程内)agent,不创建沙箱;`t.sandbox.*` / diff 断言需要 sandbox
  agent(见 `examples/zh/coding-agent-skill`)。
