# e2e/ 套件落地的两个坑(link 深度、budget 空转)

(安装被 pnpm 11 allowBuilds 占位符打断的部分见既有条目
[pnpm11-allowbuilds-placeholder-blocks-install](pnpm11-allowbuilds-placeholder-blocks-install.md),
e2e 落地时又踩了一次,`e2e/pnpm-workspace.yaml` 已预写 allowBuilds。)

## 现象 1:拷贝 tier1 项目到不同目录深度,niceeval 解析要改两处

tier1 项目对本地 niceeval 的解析是**两处配合**:package.json 的 `"niceeval": "file:../../../.."`
+ `pnpm-workspace.yaml` 的 `overrides: niceeval: link:../../../..`。从 `examples/zh/tier1/<n>`
(4 层)拷到 `e2e/apps/<n>`(3 层)时两处都要改成 `../../..`,只改 package.json 会装到不存在的路径。

**修法**:拷贝时对两个文件同步替换;`e2e/projects` 侧则不用每项目装依赖——`e2e/` 根一个
package.json(`file:..` + override `link:..`),Node 模块解析沿目录爬升,shared 和全部 projects
共用一份 node_modules。落点:`e2e/package.json`、`e2e/apps/*/pnpm-workspace.yaml`。

## 现象 2:experiment 的 `budget` 对不报 usage 的 agent 是空转

e2e 的 ci 实验设了 `budget: 1`,codex-sdk 跑到一半 runner 提示
`budget for ci: several attempts completed without any cost data … continuing without the guard`
——agent 不报 usage、或模型不在价目表里时,budget 护栏无法执行,静默降级为不设防。

**根因**:budget 按 estimatedCostUSD 累计,没有 usage/单价就永远是 0。

**修法**(使用侧结论,非代码修复):L0 门禁的成本控制实际靠"便宜模型 + runs: 3 + earlyExit",
budget 只对报 usage 且在价目表里的组合兜底;写 CI 期望时不要假设 budget 一定拦得住。
适用场景:docs/e2e-ci.md 的 L0/L1 成本护栏设计。
