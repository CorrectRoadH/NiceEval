# Handoff：bub token 用量 $0 问题

## 问题描述

bub agent 的所有 eval 运行结果中，Tokens 列始终显示 0，Cost 始终显示 $0。
这不是偶发问题，而是结构性缺失。

## 历史原因（为什么之前没修好）

### 误诊：一直在改解析器

之前的多次修改都围绕「tape 解析逻辑」展开：

- 修 `parseBubTranscript`：加更多 usage 字段的路径
- 修 tape 文件路径计算：担心 `tapePath()` 算出的 hash 不对
- 加 `extractUsageFromSpans`（derive.ts）作为 fallback ——但从未被 call
- 注释说明「bub tape 不落 usage，上游限制」——但结论之后又被怀疑，反复折腾

### 实际根因（已验证）

**bub alpha 本身就不从 OpenAI API 响应里捕获 usage。**

证据链：

1. **tape_info 工具输出**（在 OTel span 的 tool result 里明文可见）：
   ```
   last_token_usage: None
   ```
   说明 bub 有 token_usage 字段，但它就是 None。

2. **OTel chat span 无 usage 属性**：
   ```
   gen_ai.operation.name: chat
   gen_ai.request.model: openai:gpt-5.4-mini
   gen_ai.response.model: openai:gpt-5.4-mini
   openinference.span.kind: LLM
   input.value: <完整 prompt>      ← 有
   gen_ai.usage.input_tokens: 없음  ← 无
   gen_ai.usage.output_tokens: 없음 ← 无
   ```

3. **tape JSONL 里的 event/run 条目** 结构为 `{status, model}`，无 usage 字段。已对 ~100KB tape 校验。

### 为什么 bub 拿不到 usage

最可能原因：bub 用 streaming 模式调用 OpenAI 兼容 API，但没有传 `stream_options: {include_usage: true}`。OpenAI 规范里，流式响应默认不含 usage，必须显式开启。代理 `s2a.jihuayu.site` 也遵循这一规范。

这是 **bub 上游的实现缺陷**，不是 fastevals 或 adapter 的问题。

## 目前状态

| 组件 | 状态 |
|------|------|
| tape 解析器（parseBubTranscript） | 逻辑正确，但 tape 里没有 usage 可解析 |
| OTel span 读 usage（extractUsageFromSpans） | 函数存在但**从未被 call**；即使 call 了，span 里也无 usage |
| bub tape 路径计算（tapePath） | 正确，tape 能被找到（验证过 ~100KB tape） |
| 磁盘 checkpoint（100MB bub 安装快照） | ✓ 已写入 `~/.cache/fasteval/bub-checkpoint.bin` |
| Docker timeout（agent-037 601s 崩溃） | ✓ 已修，sandboxConcurrency: 2 |

## 打算怎么办

### 方案 A：推 bub 上游加 `stream_options: {include_usage: true}`（根治）

- 在 bub 的 OpenAI provider 调用处加 `stream_options: {include_usage: true}`
- bub repo: https://github.com/bubbuild/bub
- 改完后 usage 会自动写入 tape → parseBubTranscript 无需改动即可生效

### 方案 B：从 OTel span 的 `input.value` 估算（快速但粗糙）

OTel chat span 有 `input.value`（完整 prompt 文本）和 `output.value`（模型回复）。
可以：
```
estimated_input_tokens ≈ len(input.value) / 4
estimated_output_tokens ≈ len(output.value) / 4
```
在 `extractUsageFromSpans` 里加这个兜底，并在 `run.ts` 里真正调用它。
结果是估算值，有 ±20% 误差，但比 $0 有意义。

### 方案 C：接受现状，UI 上显示「N/A」而非「$0」（最省力）

在 fastevals view 里，当 inputTokens === 0 && outputTokens === 0 且 agent === "bub" 时，
显示「—」而非「0 tok」，避免用户误认为真的免费。

## 如何快速验证（方案 A 生效后）

```bash
# 1. 在 bub 容器里手动跑 bub，看 tape_info 的 last_token_usage 是否非 None
docker run -it node:24-slim bash
# 装 bub，跑一条命令，执行 tape.info 工具

# 2. 看 trace.json 里 chat span 是否有 gen_ai.usage.* 属性
cat .fasteval/<run-id>/memory/<eval>/bub/gpt-5.4-mini/a0/trace.json | \
  python3 -c "import json,sys; [print(s.get('attributes',{}).get('gen_ai.usage.input_tokens','miss')) for s in json.load(sys.stdin)]"

# 3. 跑单个 eval 验证
cd /Users/ctrdh/Code/coding-agent-memory-evals
pnpm exec fasteval --agent bub exp dev memory/agent-037-updatetag-cache
# 期望：Tokens 列显示非零值，Cost 显示非零
```

## 文件索引

| 文件 | 说明 |
|------|------|
| `src/o11y/parsers/bub.ts` | tape 解析器，逻辑正确，等上游填 usage 后自动生效 |
| `src/o11y/derive.ts:176` | `extractUsageFromSpans`，已写但未 call，方案 B 需要在 run.ts 里接入 |
| `src/runner/run.ts:398` | `usage = state.manager.usage` 之后，span 收到后，可在此插入 fallback |
| `coding-agent-memory-evals/agents/bub.ts` | bub adapter，usage 从 parseBub 取，正确但无数据 |
