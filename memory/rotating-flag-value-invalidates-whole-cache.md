# flags 里放轮换型坐标(隧道 URL),换一次全部缓存作废

**现象。** MemoryBench 的 `compare/codex-gpt-5.6-luna--nowledge` 跑到一半被止损闸停掉
(远程 mem 实例 503),已经落盘 24 条 passed。修好服务端、`vim .env` 换掉 quick tunnel URL 后重跑,
PLAN 头变成裸的 `36 attempts`——**一条都没携带**,连这次中断前的 24 条和更早几轮的结果一起丢。
第一反应会怀疑「中途退出的 run 不能 reuse」,查下来完全不是:那个快照 26 条 `result.json`
都在,`completedAt` 也补上了,携带本来就不要求快照收尾。

**根因。** `nowledgeFlags()` 把隧道 URL 塞进了实验 `flags`(`nowledgeEndpoint: <tunnel url>`),
而 `flags` 整袋进 eval fingerprint(`src/runner/fingerprint.ts` 的 payload)。cloudflared quick tunnel
每次重启换一个 URL,于是**每换一次隧道 = 全部 36 条指纹全变 = 已完成结果全部作废**。
`--dry` 两次对照实锤:`NMEM_URL=<旧 URL>` 跑出 `24 of 36 carried in from cache`,用 .env 里的新 URL 跑出 0。

这类值的共性是「运行时要读、报告要看,但值变了不改变 attempt 里发生什么」:隧道 / 反向代理 URL、
服务端实例地址、跑批时刻。`labels` 不进指纹但也不透传运行时,接不住这类值;
放 `flags` 又被整袋哈希——修改前的 niceeval 没有第三种位置,这是设计缺口不是用法失误。

**修法。**(2026-07-24,niceeval + MemoryBench 同批)

1. niceeval 加 `ExperimentDef.provenanceFlags: string[]`:列出的键照常落盘、照常透传
   `ctx.flags` / `t.flags`,只是指纹按**抹掉它们之后**的 flags 算(`src/runner/fingerprint.ts`
   的 `fingerprintFlags`)。其余 flag 照旧一变即作废。
2. 声明之前落盘的结果(指纹按整袋 flags 算)靠**反事实重算**救回:拿快照记下的
   `ExperimentRunInfo.flags` 替换本次 flags 口径重算一遍指纹,等于历史那一串就证明
   「除 flags 外一切都没变」;再要求两袋 flags 抹掉声明键后逐字相等才放行
   (`acceptableFingerprints`)。哈希不可差分,所以只能这样反着问。历史结果因此不必重跑一轮
   来「洗」,也不必去改已落盘的 `result.json`。
3. 携带判定从「指纹相等」改成「指纹 ∈ 可携带集合」(`CarryPlan.acceptableFingerprints`),
   静态规划与派发时刻的重查共用这一个集合;`plannedFingerprints` 退化成只给新跑的 attempt 打戳。
4. MemoryBench 侧:`experiments/shared/nowledge.ts` 导出 `NOWLEDGE_PROVENANCE_FLAGS`,
   五个 nowledge 实验各加一行 `provenanceFlags: NOWLEDGE_PROVENANCE_FLAGS`。

**适用场景与判据。** 往 `flags` 里放任何「每次跑都可能不一样、但不改变被测行为」的值之前,
先问一句:它变了,已经跑完的结果还算不算数?算数就必须进 `provenanceFlags`——否则表现出来
是「缓存莫名其妙全失效」,而 PLAN 头只会少掉一行 carried,不会告诉你是哪个 flag 变了。
反过来,服务端版本号(`nowledgeVersion`)这类**变了行为可能真不一样**的值不要点名,让它照常作废。

**留下的口子。** 携带落空目前没有可诊断性:0 carried 与「本来就没跑过」在输出上长得一样,
定位只能靠人肉 `--dry` 对照两次。要补的话,落点是 plan 阶段——用同一套反事实重算指出
「差异面在 flags 的哪个键 / 在 eval 源码 / 在 sandbox」。
