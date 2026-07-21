import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // .claude/worktrees 里是 agent 的临时 worktree，含整份 src 副本；不排掉会被当成正式测试跑
    // e2e/adapter/*、e2e/cli、e2e/report 是独立测试仓库，e2e/undo/* 是暂停 fixture；根 vitest
    // 都不应该递归进去——沙箱型仓库运行时会拉取真实插件/依赖内容（可能含 *.test.ts 文件），
    // 不排掉会被误当成本仓库的正式测试跑
    exclude: [
      ...configDefaults.exclude,
      ".repos/**",
      ".claude/**",
      "e2e/adapter/**",
      "e2e/cli/**",
      "e2e/report/**",
      "e2e/undo/**",
    ],
  },
});
