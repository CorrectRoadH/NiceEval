import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "cli E2E", en: "cli E2E" },
  timeoutMs: 60_000,
  // 全是 remote agent 直连真实网关(单次 HTTP 往返),不需要高并发。
  maxConcurrency: 4,
});
