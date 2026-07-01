import { defineConfig } from "niceeval";

// 回归夹具:全程不联网、不起沙箱(mock agent + 本机 mock judge,由 e2e 测试注入)。
export default defineConfig({
  name: { en: "Image Refusal Regression", "zh-CN": "拒绝识图回归夹具" },
  judge: { model: "mock-judge" },
  timeoutMs: 30_000,
  maxConcurrency: 2,
});
