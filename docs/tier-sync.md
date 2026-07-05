# Tier Sync:examples 的 origin → tier1 → tier2 同步维护方案

> **状态:已实现。** `scripts/sync-tiers.mjs`、`pnpm tiers:sync`、`pnpm tiers:check` 已落地,CI 在 `pnpm run typecheck` 之后跑 `tiers:check`。`examples/zh/.tier-sync.json` 已为现有五对目录初始化 baseTree,首次运行 `tiers:sync` 确认是无操作。

## 问题

`examples/zh/` 里同一个应用存两份:`origin/<name>` 是接入 niceeval 之前的原始应用,`tier1/<name>` 是它的完整副本加上接入产物。存两份是刻意的——`gen:diff-code` diff 这两个目录生成 before/after 文档页,"应用侧零改动"是产品卖点,所以副本文件必须和 origin 逐字节相同(只有 `package.json` / `pnpm-workspace.yaml` / `tsconfig.json` 三个脚手架文件例外)。以 codex-sdk 为例,tier1 的 21 个跟踪文件里 9 个是 origin 的逐字节副本,4 个是允许有差异的脚手架/机器产物(`package.json`、`tsconfig.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`),其余 8 个(`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`、`README.md`)是 tier 私有新增。

麻烦在于 origin 改得很勤(修 bug、调演示场景、升依赖),而副本不会自己跟上。今天给 `origin/codex-sdk/src/backend/server.ts` 修个 bug,就得记得 cp 一份到 tier1 的同名路径;要是动的是 `package.json`,连 cp 都不行——tier1 那份多着 niceeval 的集成行,只能打开手工重放同一行,再进 tier1 跑一遍 `pnpm install` 让 lockfile 跟上。这套动作对每个受影响的示例(现在 5 个)各来一遍,tier2 落地后再乘一层,而且全程只靠改动者的记忆串着。

忘了会怎样?什么都不会发生——这正是最糟的部分。没有检查、没有报警,review 时"改了 origin 而 tier1 没动"的 diff 看起来完全正常。漂移安静地躺着,直到某天重新生成 diff 文档页,陈旧差异被当成"接入 niceeval 需要改的代码"展示出来,把"零改动"卖点砸掉;或者用户跑 tier1 示例,踩到 origin 早就修掉的 bug。到那时离引入漂移的那次改动已经很远,没人记得该同步什么。

值得说清的一点:这不是"两边各改各的"的双向合并难题。实测五个示例,tier1 对共享文件的改动只有脚手架那三个文件各 2~4 行,应用源码两边完全一致;其余差异全是 tier 私有的新增文件(`agents/`、`evals/`……)和机器产物 lockfile。tier1 本质上就是"origin + 一小层接入 delta",我们缺的操作就是 `tier1 rebase origin`:origin 动了,一条命令把 delta 重放到新 origin 之上。只是原生 `git rebase` 作用于分支,而这里是同一棵树里的两个目录,原生命令用不上——本方案就是给目录对补上这个动词。

## 方案一句话

**用 rebase 的底层机制直接作用于目录树。** git 的 rebase/cherry-pick 每重放一步,内部就是一次"以共同祖先为 base 的三方合并";这个机制不要求输入是分支,`git merge-tree --write-tree --merge-base=<base>`(git ≥ 2.38)可以对任意三棵 tree 使用。于是:

- 每对目录记录一个"上次同步时上游目录的 tree hash"作为 base(相当于 rebase 里的分叉点);
- `tiers:sync` = 一条 `git merge-tree --write-tree --merge-base=<base> <tier树> <上游树>`,把 origin 自分叉点以来的全部变更重放进 tier,同时保住 tier 的接入 delta——**这就是 `tier1 rebase origin`**,冲突体验也和 rebase 一致(就地留标记,人解完继续);
- CI 用 tree hash 比对做秒级防漂移检查。

**不维护 overlay 清单**("哪些文件是 tier 私有的"由三方合并自动推导),**patch 只作为同步后自动导出的阅读产物,不作为事实源**。这也是 Google copybara / `git subtree` 解决的"目录级 vendoring + 上游追踪"问题的仓库内轻量版:合并机制 100% 是 git 自己的,脚本只做粘合。

## 为什么这样做(以及否决了什么)

### 否决:把示例做成真分支,用原生 `git rebase`

既然想要的是 rebase,最直觉的做法是让它真的可 rebase:每个示例的 origin 放一条独立分支,tier1 是它之上的接入提交,同步 = 原生 `git rebase`。否决理由:

- **示例必须同时存在于 main 的工作树里。** 文档链接指向真实目录、用户 clone 后并排浏览 origin 与 tier1、`gen:diff-code` 直接 diff 两个目录——这些都要求两份代码在同一棵树上共存。分支化之后,还得把每条分支的内容物化回 main 的目录(否则以上全断),于是"分支"与"物化目录"变成双份记账,比现在更糟;
- **分支数量是 示例数 × tier 层数,** 五个示例两层就是 10+ 条长期分支,rebase 后全部需要 force-push,历史被反复改写,协作成本失控;
- `git subtree split` 能把目录合成出伪分支再 rebase 回填,但那是三步咒语级的操作,比直接对目录树做三方合并绕远得多。

结论:要的是 rebase 的**机制**,不是 rebase 的**命令**。机制(同 base 三方合并)可以脱离分支直接用在目录树上,见"方案一句话"。

### 否决:patch 作为事实源(tier 只存 diff patch,apply 出目录)

即"tier1 只存对 origin 的 diff patch,tier2 存对 tier1 的 patch"(Debian quilt / 内核补丁队列模式)。patch 的"方便阅读"很诱人,但作为**存储格式**有四个硬伤:

- **双事实源,DX 崩坏。** 改接入代码(evals、agents、脚手架几行)时,要么手写 patch 文件——没人受得了;要么改物化目录再重新导出——目录和 patch 变成两份事实源,永远在打架。git history 也不可读了:改一行 eval,commit diff 是"diff 的 diff"。
- **示例必须是可运行、可浏览的真实目录。** 仓库规则要求文档链接指向真实目录,用户会 clone 后直接 `cd examples/zh/tier1/codex-sdk` 跑起来、在 GitHub 上直接读代码(有语法高亮和跳转,patch 文件没有)。物化产物要么提交(回到原点),要么 gitignore(文档链接与 GitHub 浏览全断)。
- **lockfile 无法用 patch 维护。** `pnpm-lock.yaml` 的内容随依赖版本剧烈漂移,patch 很快 apply 失败;它只能由 `pnpm install` 重新生成。
- **堆叠 patch 是出了名的维护地狱。** origin 改一行,可能要连修 tier1、tier2 两层 patch 的 fuzz/reject。现在的痛是"复制一遍",换成堆叠 patch 后痛变成"手工解 reject",更糟。

**"方便阅读"这个需求单独满足,不必绑架存储格式**:`gen:diff-code` 已经从两个物化目录生成 before/after 阅读页;本方案再让 `tiers:sync` 顺手导出一份 `<name>.patch` 纯阅读件(见下文)。patch 当**输出**,不当**输入**。

### 否决:纯复制 + allowDiff 清单

即维护一份清单声明"哪些文件 tier 私有、哪些允许有差异",同步 = 清单之外的文件从上游整文件复制。比 patch 好,但有两个硬伤:

- **清单要人工维护,且各示例不同**(langgraph 的 `package.json` 是 tier 私有,其它示例的是"共享但微改"),清单本身会漂移;
- **allowDiff 即检查盲区**:`package.json` 一旦列入 allowDiff,origin 给应用加依赖时,检查发现不了 tier1 没跟上。

三方合并没有这两个问题:私有文件自动推导,`package.json` 走真合并——origin 的新依赖能不能干净合入 tier1 的 `package.json`,取决于新依赖是否落在 tier 那 +2 行改动的同一位置(两者都紧挨着追加时会冲突,见下文"已知取舍");但即便冲突,也是显式报错,而不是像 allowDiff 清单那样检查不到。

### 采纳三方合并的正面理由

- **改 origin 后 tier 自动快进**:tier 从不改 `src/`,所以 `src/` 的所有变更都是无冲突快进复制,覆盖日常 95% 的场景;
- **逐字节不变的铁律从"靠自觉"变成"CI 保证"**:检查模式发现漂移直接红;
- **`gen:diff-code`、"接入只要 10-50 行"的验收方式完全不变**:两边仍是完整目录,`diff -r` 照旧;
- **tier2 免费获得同样机制**:上游指向 tier1 即可,形成 origin → tier1 → tier2 的链。

已知取舍:三方合并按行进行,两边在文件同一位置追加会冲突。这不是理论风险——沙盘验证时就复现了一例:origin 给 `dependencies` 加 `zod`、tier 在同一位置有 `niceeval`,merge-tree 就地留下标记要求人工裁决,体验与 rebase 冲突完全一致。按现有 diff 形状(脚手架文件各自只动 2~4 行)冲突频率低,且永远是**显式报错**(留标记 + check 拦截)而非静默错合。文件重命名被视为"删除 + 新增",无 rename 检测;origin 重命名文件时 tier 侧若改过该文件会报一次冲突,人工确认即可。

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

前置条件:**上游与 tier 两侧目录都必须无未提交改动**(`git status --porcelain <from> <to>` 为空)——合并的三个输入都取自提交过的 tree,同步才可复现、可回溯。工作流固定为:改 origin → 提交 → sync → review → 提交 tier。

对每一对 (from, to),核心是一条 git 命令:

```sh
git merge-tree --write-tree --merge-base=<baseTree> \
  $(git rev-parse HEAD:examples/zh/tier1/codex-sdk) \
  $(git rev-parse HEAD:examples/zh/origin/codex-sdk)
```

输出第一行是合并后的 tree hash(退出码非零表示有冲突,后续行给出冲突文件清单;冲突文件在结果 tree 里已含 `<<<<<<<` 标记)。脚本把结果 tree 检出到 tier 目录(如 `git archive <tree> | tar -x -C <to>`)即完成同步。该命令已在 git 2.50 上沙盘验证:源码修改与新增文件干净重放、tier 私有文件原样保留、同点追加正确报冲突。逐文件语义与 git merge/rebase 完全一致,等价于下表:

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

- `pnpm-lock.yaml` 从合并结果中剔除(检出时跳过),`node_modules/`、`.venv/` 本就未被 git 跟踪;合并后若 `package.json` / `pnpm-workspace.yaml` 有变动,在 tier 目录执行 `pnpm install` 重新生成 lockfile;
- 二进制文件 git 无法文本合并,两侧都改过时会作为冲突报出,人工裁决;
- 全部干净(或冲突已解)后,把该 pair 的 `baseTree` 更新为上游当前 tree hash,写回状态文件;
- 收尾时导出阅读件:`git diff <上游tree> <tier tree> > examples/zh/diffs/<name>.patch`(排除 lockfile),这份 patch 是自动再生的**展示产物**,供快速阅读"接入改了什么",与 `gen:diff-code` 的文档页同源同性质,永远不作为同步输入。

链式同步按拓扑顺序:先 origin → tier1,再 tier1 → tier2。

冲突处理与 git 一致:冲突文件就地留 `<<<<<<<` 标记,脚本列出清单并以非零码退出;人解完标记后重跑 `tiers:sync`(此时 tier 侧内容视为"改过",与上游一致或合并干净即收尾)。

### 检查模式(`pnpm tiers:check`,进 CI)

不做合并,只做两件事,秒级完成:

1. 每对的 `baseTree` ≟ `git rev-parse HEAD:<from>`——不等即"上游变了但 tier 未同步",红,提示跑 `pnpm tiers:sync`;
2. 扫描 tier 跟踪文件中的 `<<<<<<<` 冲突标记,有则红。

### 实现载体

- `scripts/sync-tiers.mjs`(约 200 行粘合代码:读状态文件、调 `git merge-tree --write-tree`、检出结果、跑 `pnpm install`、导出 patch 阅读件),合并机制本身 100% 由 git 提供,不引第三方依赖;要求 git ≥ 2.38(`merge-tree --write-tree` 的最低版本);
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
pnpm tiers:sync            # ≈ tier1 rebase origin;必要时自动 pnpm install
git diff --stat            # review tier1 侧的机器改动
git add -A examples/zh && git commit -m "sync tiers"
```

改 tier 私有文件(evals / agents / README):直接改,与同步机制无关。

改 tier1/tier2 里"应该跟上游逐字节一致"的共享文件(比如临时改一行 `src/backend/server.ts` 去验证个问题):这条路径不是方案设计要覆盖的——前提就是"tier 从不改 src/"(见"采纳三方合并的正面理由"),所以没有专门命令。改完之后有两条路:要么把改动誊回对应的 origin 文件、提交、再跑一遍 `tiers:sync` 走正常快进,让改动"转正"成一次 origin 变更;要么先放着,等下次 origin 改到同一文件同一处时被 `tiers:sync` 报冲突——冲突文件里是 `<<<<<<<` 标记,把两边改动合到一起、删掉标记、重跑 `tiers:sync` 收尾,和解普通 git rebase 冲突是同一套动作。

反过来,如果是在 tier1/tier2 里先调试出的修复,想让 origin 也拿到:同步方向是单向的 origin → tier1 → tier2,没有 backport 命令。得手工把改动誊回 origin 对应文件、提交、跑 `tiers:sync`,让 origin 补上这次变更、baseTree 也随之前进——不然下次同步会把这处改动误判成冲突。

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
