# orphans-test-assumes-ps-restricted-environment

## 现象

发现(未修,2026-07-23):`pnpm test` 在本机(macOS,`ps` 可用)稳定红一条——`src/sandbox/orphans.test.ts` 的「docker:排除留存注册表已登记条目」用例,`expect(candidates).toHaveLength(2)` 实得 1。与工作树改动无关,HEAD 上即失败。

## 根因

用例注释自陈「受限测试容器禁止 ps,真实运行时的进程启动时间探测会保守降为 unverified」——它期待属主活着的容器(label 里是当前 `process.pid`)因 `ps` 被禁而降级成 `unverified` 出现在候选里。本机 `ps` 可用,判活探测成功,属主活着的容器被如实排除,候选只剩 1 个。断言把「探测失败的降级路径」写成了对所有环境的期待,环境敏感。

## 修法

未修。方向:给 `listOrphanCandidates` 的启动时间探测留注入缝(同文件上方 `classifyRunIdentity` 用例已经这么做),或 fixture 改用异宿主 label 构造 unverified,不依赖宿主 `ps` 行为。引入 commit `791ec6e`(hard-kill-recovery 一线)。
