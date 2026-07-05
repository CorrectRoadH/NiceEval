# Tier Sync:examples 的 origin → tier1 → tier2 同步维护方案

> **状态:设计提案(未实现)。** 本文描述 `examples/zh/` 下 origin / tier1(/未来 tier2) 目录的同步机制设计。`scripts/sync-tiers.mjs`、`pnpm tiers:sync`、`pnpm tiers:check` 均尚未落地;落地后本文转为实现导读,并更新本状态行。

## 问题:现状与痛点

`examples/zh/` 下的示例按接入档位分层(tier 定义见 [Origin 应用接入手册](origin-integration.md)):

- `origin/<name>/`:未接 niceeval 的原始应用,是应用代码的**唯一事实源**;
- `tier1/<name>/`:origin 的完整副本 + 接入产物。接入铁律要求被复制的文件**逐字节不变**(除 `package.json` / `pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件),因为 `pnpm run gen:diff-code` 会 diff 两个目录生成 before/after 文档页,"应用侧零改动"是这些页面的核心卖点。

对五个示例的 git 跟踪文件实测,tier1 相对 origin 的差异只有三类:

1. **tier 私有的新增文件**:`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`、`README.md`(langgraph 因 origin 是 Python 应用,连 `package.json` / `tsconfig.json` 都是 tier 私有);
2. **微改的集成脚手架**:`package.json`(+2 行)、`tsconfig.json`(±2 行)、`pnpm-workspace.yaml`(+3~4 行);
3. **机器产物**:`pnpm-lock.yaml`(由 `pnpm install` 生成,不该手工维护)。

应用源码(`src/` 等)在两边**完全一致**。所以痛点不是"同一文件两边各改各的要合并",而是:**每次改 origin,都要人肉记得把同样的改动复制到 tier1;忘了就静默漂移,没有任何检查会报警。** 示例数量和 tier 层数(tier2 在路上)都在涨,这个人肉成本是乘法。

## 方案一句话

把每个 tier 目录当成上游目录的**下游 vendored 副本**,用 git 本身做三方合并机器:每对目录记录一个"上次同步时上游的 tree hash"作为 base,同步 = 对每个共享文件做 base / 上游现状 / tier 现状 的三方判定,CI 用 tree hash 比对做秒级防漂移检查。**不存 patch 文件,不维护 overlay 清单**——"哪些文件是 tier 私有的"由三方比较自动推导。

这就是 Google copybara / `git subtree` 解决的"目录级 vendoring + 上游追踪"问题的仓库内轻量版,先例成熟。

## 为什么这样做(以及否决了什么)

### 否决:tier 存成 patch 队列,apply 出目录

即"tier1 只存对 origin 的 diff patch,tier2 存对 tier1 的 patch"(Debian quilt / 内核补丁队列模式)。否决理由:

- **示例必须是可运行、可浏览的真实目录。** 仓库规则要求文档链接指向真实目录,用户会 clone 后直接 `cd examples/zh/tier1/codex-sdk` 跑起来、在 GitHub 上直接读代码。patch 既跑不了也读不了,必须加"物化"步骤——物化产物要么提交(回到原点),要么 gitignore(文档链接与 GitHub 浏览全断)。
- **lockfile 无法用 patch 维护。** `pnpm-lock.yaml` 的内容随依赖版本剧烈漂移,patch 很快 apply 失败;它只能由 `pnpm install` 重新生成。
- **堆叠 patch 是出了名的维护地狱。** origin 改一行,可能要连修 tier1、tier2 两层 patch 的 fuzz/reject。现在的痛是"复制一遍",换成堆叠 patch 后痛变成"手工解 reject",更糟。

### 否决:纯复制 + allowDiff 清单

即维护一份清单声明"哪些文件 tier 私有、哪些允许有差异",同步 = 清单之外的文件从上游整文件复制。比 patch 好,但有两个硬伤:

- **清单要人工维护,且各示例不同**(langgraph 的 `package.json` 是 tier 私有,其它示例的是"共享但微改"),清单本身会漂移;
- **allowDiff 即检查盲区**:`package.json` 一旦列入 allowDiff,origin 给应用加依赖时,检查发现不了 tier1 没跟上。

三方合并没有这两个问题:私有文件自动推导,`package.json` 走真合并——origin 的新依赖会被合并进 tier1 的 `package.json`(tier 的 +2 行改动在不同位置,合并干净)。

### 采纳三方合并的正面理由

- **改 origin 后 tier 自动快进**:tier 从不改 `src/`,所以 `src/` 的所有变更都是无冲突快进复制,覆盖日常 95% 的场景;
- **逐字节不变的铁律从"靠自觉"变成"CI 保证"**:检查模式发现漂移直接红;
- **`gen:diff-code`、"接入只要 10-50 行"的验收方式完全不变**:两边仍是完整目录,`diff -r` 照旧;
- **tier2 免费获得同样机制**:上游指向 tier1 即可,形成 origin → tier1 → tier2 的链。

已知取舍:三方合并按行进行,理论上两边同时在文件同一位置追加会冲突——但冲突是**显式报错**(留标记 + check 拦截)而非静默错合,且按现有 diff 形状(脚手架文件各自只动 2~4 行、位置不重叠)会很罕见。文件重命名被视为"删除 + 新增",无 rename 检测;origin 重命名文件时 tier 侧若改过该文件会报一次冲突,人工确认即可。

## 如何实现

### 状态文件

单独一份 `examples/zh/.tier-sync.json`,**不放进各示例目录**——tier 目录里多任何一个文件都会出现在 `gen:diff-code` 的 before/after 页上,污染"接入只新增了这些文件"的叙事:

```json
{
  "pairs": [
    { "from": "examples/zh/origin/codex-sdk",  "to": "examples/zh/tier1/codex-sdk",  "baseTree": "a1b2c3..." },
    { "from": "examples/zh/origin/langgraph",  "to": "examples/zh/tier1/langgraph",  "baseTree": "d4e5f6..." }
  ]
}
```

`baseTree` 是上次同步时上游目录的 git tree hash(`git rev-parse HEAD:examples/zh/origin/codex-sdk`)。base 的**内容**不需要另存——git 对象库天然保管,`git cat-file blob <baseTree>:<相对路径>` 随取随用。配对关系也可由约定推导(同名目录出现在相邻两层即为一对),状态文件里只需 baseTree;先按显式 pairs 实现,更直白。

### 同步算法(`pnpm tiers:sync [name]`)

前置条件:**上游目录必须无未提交改动**(`git status --porcelain <from>` 为空)。base 永远指向提交过的 tree,同步才可复现、可回溯。工作流固定为:改 origin → 提交 → sync → review → 提交 tier。

对每一对 (from, to),文件全集取 base tree 与上游当前跟踪文件的并集,逐文件三方判定:

| 上游侧(base → 现在) | tier 侧(base → 现在) | 动作 |
| --- | --- | --- |
| 没变 | 任意 | 不动 |
| 变了 | 未改(== base) | **快进**:整文件复制 |
| 变了 | 改过 | `git merge-file` 三方合并;冲突留标记并报出 |
| 新增 | tier 无同名文件 | 复制过来 |
| 新增 | tier 已有同名文件 | 报冲突(极罕见,人工裁决) |
| 删除 | 未改(== base) | 跟着删 |
| 删除 | 改过 | 报冲突 |

只出现在 tier 侧、base 与上游都没有的文件,自动视为 **tier 私有**,永远不碰——`agents/`、`evals/`、langgraph 的 `package.json` 都落在这条规则里,无需任何配置。

排除项与特例:

- `pnpm-lock.yaml`、`node_modules/`、`.venv/` 不参与合并;合并后若 `package.json` / `pnpm-workspace.yaml` 有变动,在 tier 目录执行 `pnpm install` 重新生成 lockfile;
- 二进制文件(`git merge-file` 拒绝处理的)只允许快进,tier 侧改过则报冲突;
- 全部干净(或冲突已解)后,把该 pair 的 `baseTree` 更新为上游当前 tree hash,写回状态文件。

链式同步按拓扑顺序:先 origin → tier1,再 tier1 → tier2。

冲突处理与 git 一致:冲突文件就地留 `<<<<<<<` 标记,脚本列出清单并以非零码退出;人解完标记后重跑 `tiers:sync`(此时 tier 侧内容视为"改过",与上游一致或合并干净即收尾)。

### 检查模式(`pnpm tiers:check`,进 CI)

不做合并,只做两件事,秒级完成:

1. 每对的 `baseTree` ≟ `git rev-parse HEAD:<from>`——不等即"上游变了但 tier 未同步",红,提示跑 `pnpm tiers:sync`;
2. 扫描 tier 跟踪文件中的 `<<<<<<<` 冲突标记,有则红。

### 实现载体

- `scripts/sync-tiers.mjs`(约 200 行,Node + git plumbing:`rev-parse` / `ls-tree -r` / `ls-files` / `cat-file` / `merge-file -p`),不引第三方依赖;
- `package.json` 增加 `"tiers:sync": "node scripts/sync-tiers.mjs sync"`、`"tiers:check": "node scripts/sync-tiers.mjs check"`;
- CI(现有 lint/typecheck 步骤旁)加一步 `pnpm tiers:check`。

## 日常工作流(before / after)

改 origin 应用源码——现在:

```sh
vim examples/zh/origin/codex-sdk/src/backend/agent.ts
# 然后必须人肉记得 tier1 有一份同样的文件:
cp examples/zh/origin/codex-sdk/src/backend/agent.ts \
   examples/zh/tier1/codex-sdk/src/backend/agent.ts
# 忘了 cp?没有任何检查会发现,diff 文档页从此静默失真。
```

改 origin 应用源码——方案落地后:

```sh
vim examples/zh/origin/codex-sdk/src/backend/agent.ts
git add examples/zh/origin/codex-sdk && git commit -m "..."
pnpm tiers:sync            # tier1 快进,必要时自动 pnpm install
git diff --stat            # review tier1 侧的机器改动
git add -A examples/zh && git commit -m "sync tiers"
```

改 tier 私有文件(evals / agents / README):直接改,与同步机制无关。

origin 给应用加依赖(动了 `package.json`)——三方合并把新依赖行合进 tier1 的 `package.json`(tier 自己的 `"niceeval": "file:../../../.."` 在另一行,不冲突),随后自动 `pnpm install` 更新 lockfile。

忘了同步就提交?CI 的 `tiers:check` 红:

```text
✗ examples/zh/tier1/codex-sdk 落后于 origin/codex-sdk
  base a1b2c3… ≠ 当前 9f8e7d…,运行 pnpm tiers:sync 后重新提交
```

## 验收标准(实现时逐条核对)

1. 对现有五个示例首次初始化 base 后,`tiers:sync` 是无操作(两边已一致);
2. 改 origin 任一 `src/` 文件 → sync 后 tier1 同文件逐字节一致,`gen:diff-code` 输出不含该文件;
3. 改 origin `package.json`(加一个依赖)→ sync 后 tier1 的 `package.json` 同时含新依赖与 niceeval 集成行,lockfile 已重装;
4. origin 与 tier1 在同一文件同一区域都有改动 → sync 报冲突、留标记、非零退出;`tiers:check` 在标记未解前保持红;
5. langgraph(origin 为 Python、`package.json` 为 tier 私有)全流程不误伤 tier 私有文件;
6. `tiers:check` 在 base 落后时红、同步后绿,全程不写任何文件。
