import { defineConfig } from "niceeval";

// 回归夹具:CLI --output profile 机制自身的验收(见 plan/exp-output-feedback-models.md
// 「CLI spawn 验收」测试矩阵)。这里不测某条 eval 的判定逻辑,只测 ANSI 有无、auto 探测、
// --dry 是否落盘这几件与 eval 内容无关的 CLI 行为,所以只配一条恒定通过的 eval。
// 全程不联网、不起沙箱、不需要 judge(remote mock agent 秒回固定文本)。
export default defineConfig({
  name: { en: "CLI Output Profiles Regression", "zh-CN": "CLI 输出 profile 回归夹具" },
  timeoutMs: 30_000,
  maxConcurrency: 2,
});
