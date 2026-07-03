---
name: codex-mapcodexspans-not-publicly-exported
description: docs/origin-integration.md 建议黑盒 codex-sdk 接入用内置 codex spanMapper 归一瀑布图,但 mapCodexSpans 没有从 "niceeval/adapter" 公开导出,外部/示例包只能省略 spanMapper 走通用 heuristic
metadata:
  type: infra-bug
---

**现象**：`docs/origin-integration.md` 里 codex-sdk 那一节写"瀑布图经内置 codex mapper
(`spanMapper: mapCodexSpans` 思路)把 span 归一后画图"。真去接 `examples/zh/tier1/codex-sdk`
时,`mapCodexSpans` 实际定义在 `src/o11y/otlp/mappers/codex.ts`,只从
`src/agents/codex.ts`(内置 `codexAgent` 用)内部 import,**没有**出现在
`src/agents/index.ts`(也就是 `"niceeval/adapter"` 子路径导出面)里,`package.json` 的
`exports` 字段也只开了 `"."` / `"./sandbox"` / `"./adapter"` / `"./expect"` /
`"./reporters"` / `"./loaders"` 几个子路径——深路径 `import {...} from "niceeval/o11y/otlp/mappers/codex.ts"`
会被 Node 的 `exports` map 直接拒绝解析(`ERR_PACKAGE_PATH_NOT_EXPORTED`),不区分是本仓库
monorepo 内部引用还是外部 `npm install niceeval` 之后的引用——`examples/zh/tier1/*` 走的都是
`"niceeval": "file:../../../.."` + pnpm `overrides: niceeval: link:../../../..`,本质上就是
"当作已发布包来用",一样吃这个限制。

**根因**：`mapCodexSpans` 目前被当成"内置 `codexAgent` 的私有实现细节",没有被设计成公开
API;`docs/origin-integration.md` 写这一节时假设了它可以被黑盒 adapter 复用,但没有对照
`package.json` 的 `exports` 核实这条路径真的可达。

**修法 / 适用场景**：
- 本次(`examples/zh/tier1/codex-sdk/agents/codex-sdk.ts`)处理方式:`tracing` 块正常声明
  (`scope: "run"` + `env` 剥掉 `/v1/traces` 尾巴),但**省略 `spanMapper`**——`Agent.spanMapper`
  类型注释本来就允许省略("省略时 core 走通用 heuristic 兜底"),core 的通用 heuristic 兜底
  接管,瀑布图仍然能画,只是没有 codex 专属的 span 命名归一。
- 如果以后真的需要黑盒接入享有和内置 `codexAgent` 一样精确的瀑布图,两个方向选一个:
  (a) 把 `mapCodexSpans` 提升成 `"niceeval/adapter"` 的公开导出(改 `src/agents/index.ts`
      + 可能要顺手把 `src/o11y/otlp/mappers/codex.ts` 挪到不那么"内部实现细节"观感的位置);
  (b) 在示例里自己抄一份等价的轻量 span 归一逻辑,不依赖 core 内部路径。
  两者都不在 Tier 1 工单范围内("只做黑盒接入,不碰 core"),这次没做,仅记录。
- 类似的"文档假设了一个未公开导出的内部符号"问题,以后接其它需要专属 spanMapper /
  内置 dialect 之外能力的应用时,先用这个方法核实一遍:`grep` 目标符号是否出现在
  `src/agents/index.ts` 或其它 `src/*/index.ts` 的 `export` 列表里,而不是直接假设
  `docs/` 里写的类名/函数名一定可以从 `"niceeval"` / `"niceeval/adapter"` 导入。
