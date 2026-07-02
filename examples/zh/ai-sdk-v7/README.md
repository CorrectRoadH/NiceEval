# AI SDK v7 × 内建适配器示例

这个例子在 [`examples/zh/ai-sdk-v7-before`](../ai-sdk-v7-before/) 的基础上接入 **niceeval 官方
内建的 AI SDK 适配器** `aiSdkAgent`。应用代码(`agent/`)不 import 任何 niceeval 的东西,
唯一的改动是 `chat` 多收一个可选 `opts`(取消信号 + telemetry 透传);eval 侧只声明「怎么召
模型」(`generate`)和「结构化输出取什么」(`data`),会话历史、事件流、HITL 握手、失败兜底、
OTel 管线全部由工厂承担。两个目录的 diff 就是接入 niceeval 需要改动的全部内容:

```sh
diff -ru examples/zh/ai-sdk-v7-before examples/zh/ai-sdk-v7
```

和隔壁 [`examples/zh/ai-sdk`](../ai-sdk/)(v6,自己写 adapter + 双可观测)是互补关系——那边
演示怎么自己写 adapter,这边演示内建 adapter 怎么接。

## 接线方式

eval 侧的接线全部在 [`experiments/assistant.ts`](experiments/assistant.ts):

```ts
// experiments/assistant.ts
import { aiSdkAgent } from "niceeval/adapter";
import { chat } from "../agent/assistant.ts";

export const assistant = aiSdkAgent<ModelMessage>({
  name: "ai-sdk-v7",
  capabilities: { tracing: true },
  otlpBackendUrl: process.env.OTLP_BACKEND_URL,   // 可选:span 双发到你自己的后端
  generate: ({ messages, model, signal, telemetry }) => chat(messages, model, { signal, telemetry }),
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
原样透传给 `generateText`。设 `OTLP_BACKEND_URL` 时,同一批 span 同时双发到你自己的
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

跨模型对比写**多个实验文件**:`experiments/compare-models/` 下每个文件钉一个 `model`
(`model` 是单个字符串,不接受数组)。

注意:

- `image-understanding` 只在支持视觉的模型上真跑,其余模型 `t.skip`。当前 `agent/models.ts`
  把 gpt-5.4 标为不支持 —— 不是模型不行,是经 `OPENAI_BASE_URL` 网关传图会被拒(详见
  `memory/openai-proxy-image-input-broken.md`);直连 OpenAI 后把 `supportsVision` 改回
  `true` 即可。
- 没有 judge API key 时,judge 断言自动跳过,确定性断言照常跑;judge 模型配置在
  `niceeval.config.ts`(默认 `gpt-5.4`,走 `OPENAI_API_KEY`)。
- 这里注册的是 remote(进程内)agent,不创建沙箱;`t.sandbox.*` / diff 断言需要 sandbox
  agent(见 `examples/zh/coding-agent-skill`)。
