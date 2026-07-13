# TODO：docs ↔ 代码对齐的剩余欠账

> 来源：2026-07-12 的 docs/ 与代码一致性审计（30 条）。文档侧的漂移**已全部收口并提交**（`31a850a` 及其之前的六个 docs commit）；本文件只登记**仍需动代码**的欠账，以及一份新暴露出的设计缺口。
>
> 每条独立可执行，互不阻塞。**不要在同一个 commit 里做两条。**
>
> 不在本文件里：Benchmark 阶段计时（`AttemptRecord.phases`，`docs/engineering/benchmark/README.md`，commit `946df65`）——用户明确单独处理。

## 收口状态（对照 `plan/docs-code-alignment-closeout.md`）

> 逐项标注可核验证据（测试名 / 命令输出 / 文件路径 / commit）；没有独立证据支撑的一律保持未完成，不因某路 agent 的报告说“做了”就直接勾选——报告本身写明受阻或部分完成的，这里如实保留受阻状态。新读者只看这一区块即可判断哪些是代码完成、哪些是真机完成、哪些仍未完成。

> **round 2 总结（2026-07-13）**：本文件此前登记的欠账里，**四项已用真实证据收口**——B 的「矩阵补全 · 多 Skill 仓库选择」（Claude Code、Codex 各自真实 Docker + 真实 agent turn 全通过）、B 的「路径提升」运行器编排逻辑单测（新增 `src/runner/attempt.test.ts`，3/3 通过）、A 的 `COLUMNS=48` 未触发压缩、A 的 `--report` “首行”非表头——后两条经复核确认是**消费项目 fixture 自然宽度与既有数据的客观特性，不是代码缺陷**，不再作为 open gap 保留。**唯一仍未闭合、且不属于「可由实现工作解决」的一项**：Claude Code repo Skill 的 `calledTool("Skill")` 行为断言在 e2e 默认代理模型 `deepseek-v4-flash` 下不触发——根因已定位（该模型不走 Claude 原生 Skill 工具包装，装的技能内容确实被读取只是走了通用 `Read` 工具），修复需要切到真实 Anthropic 模型（新增凭据与真实 API 成本），**这是需要用户裁决的开放问题，不是未完成的实现工作**，详见 `memory/skill-install-via-git-not-skills-cli.md` 第 4 条。

### A. `<Table>` 双面原语与文本排版工具箱

- [x] **文档**：`docs/feature/reports/library.md`（`<Table>` 契约、第 424 行“`MetricTable`、`MetricMatrix`、`Scoreboard` 和 `DeltaTable`”四个表状组件的正确表述）、`docs-site/zh/guides/report-components.mdx`「表格（`Table`）」一节（含中文示例）、`docs-site/zh/guides/custom-reports.mdx`「换形态：表格用 Table，其余自己画」一节均已写入目标契约；`.padEnd(8)` 手搓示例已不存在（`grep -c "padEnd(8)" docs-site/zh/guides/custom-reports.mdx` → 0）。本文件“六个表状组件”的错误表述已改为四个（见下方「第 3 层」与「阶段 3」两处），并把 A 阶段的「官方组件重建」（阶段 3）与「真实冒烟」（阶段 4）拆成两个独立可判断的状态。
- [x] **`<Table>` 实现**：代码本来就是目标形态，未改动实现逻辑。`src/report/index.ts:30-43` 确认导出 `Table`、`TableProps`、`stringWidth`、`padEnd`、`padStart`、`wrapText`、`indent`、`bar`、`columns` 共 9 个名字，与契约逐一对应。
- [x] **官方四个表状组件迁移的测试覆盖**：`src/report/text/faces.ts` 静态引用确认 `tableText`（145 行）/`matrixText`（189 行）/`scoreboardText`（301 行）/`deltaText`（449 行）均调用 `renderTableText`；`experimentListText`/`evalListText`/`attemptListText` 三个实体列表不调用。`pnpm exec vitest run src/report/dual-render.test.tsx` → 55/55 passed（含新增的 Scoreboard 全科缺席 `null→—` 用例，以及 AttemptList/EvalList/ExperimentList 三个「按空行分块 + 缩进正则」的卡片形状保护测试——`renderTableText` 无法产生这种输出形状）。
- [x] **默认 `show` 回归（未变）**：`src/show/show.test.ts` 未改动，`pnpm exec vitest run src/show/show.test.ts` → 28/28 passed；本轮 A 相关改动的 `git diff --stat` 对 `src/show/**`、`src/report/text/**`、`src/report/components.tsx`、`src/report/primitives.tsx` 零 diff。
- [ ] **中文自定义报告真机冒烟**：**部分完成**——核心契约已用真实消费项目证实，剩余一处未满足字面验收（消费项目级 `pnpm run typecheck` 退出码 `2`，与本次改动无关，见下），如实保留未完成。已证实：CJK 列按 `stringWidth`（非 `.length`）对齐（`中文任务`.length=4，实测终端显示宽度 8；KIND 列在表头/两行数据的显示列起点一致为 11）；数字列右对齐（`7`/`123` 前导空格差 = 数值宽度差）；`null → —`；带 locator 的行可执行 `niceeval show @160iuj3h` 下钻（exit 0，打开同一 attempt）；窄宽度“压列/丢列并报告剩余”契约已用真实 PTY（30 列）证实存在（输出 `(1 more column not shown)`）。**以下两处此前误列为「未满足验收」，复核后确认是 fixture / 既有数据的客观特性，不是代码缺陷，不再作为 open gap**：① 计划指定的 `COLUMNS=48` 对这份 fixture 的自然宽度（44–46）本就小于 48，不会触发压缩分支——是这份锁定形状 fixture 的宽度巧合，不是机制失效；窄宽度压缩/截断契约本身已用另一份 30 列真实 PTY 测试独立证实工作正常（见上）。② `--report` 输出“首行”经改用 `./node_modules/.bin/niceeval` 直接调用（绕开 `pnpm exec` 的前导输出）复核，剩下的首行内容是消费项目自己既有 `.niceeval` 数据触发的“snapshot … is unfinished”诊断警告——这是如实报告数据不完整的正确产品行为，是消费项目自身数据的真实状态，不是本任务范围内可以改动的东西（改它等于篡改用户既有数据）。仍未满足字面验收的唯一一处：消费项目级 `pnpm run typecheck` 退出码 `2`，根因是既有无关文件 `reports/memory-conditions.tsx`（非本 fixture，fixture 隔离编译 exit 0）。证据文件：`/Users/ctrdh/Code/coding-agent-memory-evals/reports/alignment-table-smoke.tsx`（长期 fixture）、`tmp/alignment-default-show.txt`、`tmp/alignment-table-smoke.txt`、`tmp/alignment-table-smoke-narrow.txt`。

### B. Coding Agent 的 Skills / Plugins

- [x] **类型 / 实现（已有）**：`src/agents/types.ts` 定义 `SkillSpec`（local/repo，repo 支持 `ref` 与 skills 子集选择）与 `AgentSetupManifest`；`src/agents/skills.ts` 的 `installSkills` 实现本地与 repo 两种安装（`git clone → git checkout <ref> → cp -R`，不调用 `npx skills add`）；`src/agents/claude-code.ts`/`src/agents/codex.ts` 各自实现 `ClaudeCodePluginSpec`/`CodexPluginSpec` 的 `installPlugins`（互不共享类型）；`src/agents/bub.ts` 实现 `PythonPluginSpec`。
- [x] **单元测试（新增）**：`installPlugins` 由 private 改为 export（无行为变化），新增 `src/agents/claude-code.test.ts`（8 用例，命令构造 + 失败语义）、`src/agents/codex.test.ts`（10 用例，同上，另含真实 `codex plugin list --json` 输出形状回归）；`pnpm exec vitest run src/agents/claude-code.test.ts src/agents/codex.test.ts src/agents/plugin-config.test.ts` → 3 files / 20 tests passed。编译期类型测试 `src/agents/plugin-config.test.ts` 证明 Bub 收 MCP/plugins、Codex/Claude Code 收 `pythonPlugins`、`plugins` 字段塞 `PythonPluginSpec` 形状均编译失败（`@ts-expect-error` 生效，已用临时删除验证其非装饰性）。**已知缺口**：Claude Code `plugins` 与 Codex `plugins` 互换因两者结构完全同形（`{ marketplace: { name, source, ref? }, name }`）在类型系统层面无法区分，`docs/feature/adapters/coding-agent-skills-plugins.md` 已知悉此限制，未能覆盖，非遗漏。
- [ ] **Claude Code 真机 · repo Skill**：安装侧完成；行为侧断言未命中，但根因已定位为**需要用户裁决的开放问题，不是未完成的实现工作**。真实 Docker + 真实 Anthropic API 两轮运行，最新一轮 `.niceeval/features/2026-07-13T03-28-53-896Z-3rw4/feature-skill-used/{a0,a1}/result.json` 的 `verdict` 均为 `"failed"`。`ref` 已钉定到 `b5026c68318f395bbfd258182ea6b524ff2be549`（`e2e/projects/claude-code/agents/claude-code-features.ts:11`）；安装痕迹断言（send 前读 `__niceeval__/agent-setup.json` 含 `effect-ts`）3/3 通过；行为断言 `calledTool("Skill", { input: { skill: "effect-ts" } })` 3/3 未命中——`events.json` 静态核实零命中，根因已确认是 e2e 默认代理模型 `deepseek-v4-flash`（非原生 Anthropic 模型）不触发 Claude Code 原生 Skill 工具包装，不是本次任何改动引入的回归；`judge.autoevals.closedQA` 证实回答内容确实来自该 skill 文件，只是走了通用 `Read` 而非 `Skill` 工具，即安装与内容读取均正确，唯独“原生 Skill 工具是否被调用”这一行为信号在此模型下不产生。修复路径是把这条断言切到真实 Anthropic 模型（涉及新增凭据与真实 API 成本），**是否要做这个切换需要用户裁决**，已记录在 `memory/skill-install-via-git-not-skills-cli.md` 第 4 条；在裁决之前，此项保持“行为断言未通过”的如实状态，不因安装侧成功而拔高，也不算作本 TODO 范围内待实现的工作。
- [x] **Claude Code 真机 · local Skill**：完成。新增 `e2e/fixtures/skills/local-smoke/SKILL.md`、`e2e/projects/claude-code/agents/claude-code-local-skill.ts`、`experiments/local-skill.ts`、`evals/local-skill-used.eval.ts`。`node ../../../bin/niceeval.js exp local-skill --force` 三轮真实运行退出码均为 `0`；最新一轮 `.niceeval/local-skill/2026-07-13T03-43-33-260Z-ehpf/local-skill-used/a0/result.json` 的 `verdict` 为 `"passed"`。改 1 字节 fixture 内容 → manifest `sha256` 改变；还原该字节 → `sha256` 恢复原值——三轮全部用真实沙箱验证，只用 Edit 工具改 fixture。
- [x] **Codex 真机**：完成。`ref` 已钉定到同一 commit（`e2e/projects/codex/agents/codex-features.ts:12`）。`node ../../../bin/niceeval.js exp features feature-skill-used --force` 第二轮 `.niceeval/features/2026-07-13T03-30-24-766Z-7t0v/feature-skill-used/{a0,a1}/result.json` 的 `verdict` 均为 `"passed"`；send 前直接读取 `.agents/skills/effect-ts/SKILL.md`（9895 字节）与 `AGENTS.md`（含 `.agents/skills`/`effect-ts` 发现指引）经宿主 `docker exec` 独立验证存在；行为断言用既有 `calledTool("shell", ...)`，命中 `.agents/skills/effect-ts` 路径，未假造原生 Skill 工具，与 `memory/codex-no-native-skill-tool.md` 结论一致。
- [x] **artifact 读回（`e2e/scripts/verify-agent-setup.mts`）**：已验证通过，脚本存在且被独立复跑确认：
  ```
  node --import tsx e2e/scripts/verify-agent-setup.mts e2e/projects/claude-code/.niceeval @11ntguqf
  → OK: attempt.agentSetup() deep-equals .../native-plugin/2026-07-13T04-08-19-887Z-j6i3/native-plugin-installed/a0/agent-setup.json (exit 0)
  node --import tsx e2e/scripts/verify-agent-setup.mts e2e/projects/codex/.niceeval @181uuebt
  → OK: attempt.agentSetup() deep-equals .../native-plugin/2026-07-13T04-19-12-419Z-9e5a/native-plugin-installed/a0/agent-setup.json (exit 0)
  ```
  **原「已知缺口」已补齐**：`src/runner/attempt.ts` 里从 sandbox 读回 manifest、提升为 attempt artifact 的这一步（“路径提升”）此前没有独立于真实 sandbox e2e 的单元测试。新增 `src/runner/attempt.test.ts`（内存 `FakeSandbox`，不起容器/不联网，直接驱动 `runAttemptEffect`），三个用例：manifest 存在时原样深相等挂到 `result.agentSetup`；未装任何 skill/plugin/mcp 的基线场景不生成伪造的空 artifact（`result.agentSetup` 为 `undefined`）；agent 根本没有 `setup` 钩子时同样保持 `undefined`。`pnpm exec vitest run src/runner/attempt.test.ts` → 3/3 passed；`pnpm run typecheck` 干净；`pnpm test` 全量回归无新增失败。
- [x] **矩阵补全 · 多 Skill 仓库选择**：完成，Claude Code 与 Codex 双侧真实 Docker + 真实 agent turn 均通过。选中的 Skill 为 `template`（`anthropics/skills`，钉定 commit `9d2f1ae187231d8199c64b5b762e1bdf2244733d`，与既有 native-plugin/repo-skill 用的 fixture commit 一致，经 `git ls-remote` 核实仍是 HEAD）；`pdf`（真实存在但未选中的 skill，80KB、带 Python 脚本依赖）用作“未选中目录不存在”的负向对照。新增文件：`e2e/projects/claude-code/agents/claude-code-multi-skill.ts`、`e2e/projects/codex/agents/codex-multi-skill.ts`、两侧 `evals/multi-skill-selected.eval.ts`、两侧 `experiments/multi-skill.ts`；两侧 `experiments/ci.ts` 追加 `"multi-skill-"` 到 `excludeIdPrefixes`。命令与结果：`node ../../../bin/niceeval.js exp multi-skill --force` 在两个项目下均 `EXIT_CODE=0`，`result.json` 的 `verdict` 均为 `"passed"`（Claude Code 9/9 断言通过，Codex 11/11 断言通过，已独立复核）。`agent-setup.json`（两侧内容一致）：`{"skills":[{"kind":"repo","source":"anthropics/skills","ref":"9d2f1ae187231d8199c64b5b762e1bdf2244733d","skills":["template"]}]}`——`skills[0].skills` 恰好是 `["template"]`，不含其余 17 个 skill。“未选中目录不存在”的现场断言：Claude Code `.claude/skills/pdf` 不存在、Codex `.agents/skills/pdf` 不存在，均在 sandbox 销毁前断言通过并记录进各自 `result.json`；同时确认 `.claude/skills/template/SKILL.md` / `.agents/skills/template/SKILL.md` 非空，即选中的 skill 确实落盘。`e2e/scripts/verify-agent-setup.mts` 对两侧分别做了 `AttemptHandle.agentSetup()` 与磁盘 artifact 的深相等复核，均 `OK`。
- [x] **矩阵补全 · native plugin**：完成，双 agent 真实 Docker e2e 均通过。fixture 固定到 `duyet/codex-claude-plugins`，钉定 commit `82de4021a311034a9596e891baf3a8266fb33bf7`。`.niceeval/native-plugin/2026-07-13T04-08-19-887Z-j6i3/native-plugin-installed/a0/result.json`（Claude Code）与 `.niceeval/native-plugin/2026-07-13T04-19-12-419Z-9e5a/native-plugin-installed/a0/result.json`（Codex）的 `verdict` 均为 `"passed"`，且均确认 `result.json` 不含内联 `agentSetup` 字段。过程中发现并修复两个真实 bug：`src/agents/codex.ts` 的 `installedVersion()` 此前解析的 JSON 形状与真实 `codex plugin list --json` 输出（`{ installed: [{ pluginId, version }] }`）不符（记入 `memory/codex-plugin-list-json-shape-guessed-wrong.md`）；`src/util.ts` 的 `brief()` 对 `undefined` 输入崩溃（记入 `memory/brief-crashes-on-preview-undefined.md`）；两者均有回归测试。**未覆盖**：Bub 无 native-plugin 概念，未做真机 e2e，只有类型级测试覆盖（`plugin-config.test.ts` 的 Bub 拒收 MCP/plugins 断言）。另发现一个未修复的真实 bug——`marketplace.name` 实际由目标 repo 自身 manifest 决定，并非调用方可自由指定字符串，文档现状与真实 CLI 行为不符——记入 `memory/native-plugin-marketplace-name-not-caller-assignable.md`，本次复核确认该文件存在；这是一个契约层面的决策，未在本轮修复，超出本轮范围。

### C. `src/` 注释里 85 处死链

- [x] **已完成**。commit `b9537e7`（“docs: repoint stale doc paths in comments; guard them with a test”）修复全部死链；`test/docs-consistency.test.ts` 新增守护用例「代码注释里的 docs/….md 路径指向真实文档」。全仓扫描 `rg -n "docs/reports\.md|docs/results-format\.md|docs/results-lib\.md|docs/view\.md|docs/scoring\.md|docs/sandbox\.md" src/ --glob '*.ts' --glob '*.tsx'` → 0 处命中。

## 已经处理掉的（不必再看，防止重复劳动）

- **文档写错、代码是对的** → 已按代码重写文档：判定优先级（`errored > failed > skipped > passed`）、`Config` 的 `name`/`workspace`/`telemetry`/`PriceOverride`、`.eval.tsx` 发现、`Sandbox` 接口快照、`t.group` / 沙箱二进制 IO / `noFailedShellCommands`、`readSourceFiles(opts)` 签名、`EvalDef.setup`、`ExperimentDef.maxConcurrency`、`uploadDirectory` 的 `opts.ignore`、`AgentContext.reasoningEffort`、judge 无 key 时静默 no-op、`aiSdkAgent` / `aiSdkOtel`、codex 鉴权（`CODEX_API_KEY`，无 login/profile）、`classifySnapshot` / `exitOnViewUserError` / `estimateCost` 等名字、`resolveLocator`、并发推荐值（vercel=1，不是「云的可以开大」）、`architecture.md` 的源码树。
- **代码有 bug、文档是对的** → 已改代码：`t.loadedSkill()` 改读 `skill.loaded` 一等事件（原先是 `calledTool("load_skill")` 的糖，在 Claude Code 上永远断不中）；`EvalDef.setup` 返回的 `Cleanup` 原先被 `attempt.ts` 丢弃、从不执行，现已在 finally 里 LIFO 调用。
- **文档描述了不该存在的能力** → 已删：AI 失败分类 / `classification.json`（commit `4176eea`）。

---

## A. 文本面「列对齐」没有标准件，官方与用户组件不对等

**性质**：设计缺口。不是某一处写错，是**公开面缺了一层**——照现在的文档写自定义组件，遇中文必歪。

**现象**。`niceeval show` 的表格是列对齐的产物：

```text
STATUS      EVAL                                ATTEMPT     RESULT                              DURATION  COST
✓ passed    memory/agent-037-updatetag-cache    @160iuj3h   —                                   2m 0s     $0.09
✗ failed    memory/swelancer-manager-proposals  @1qrdcfq8   expected 4, received 1 · equals(4)  50.0s     $0.05
```

官方组件靠 `src/report/text/layout.ts` 画出它（`stringWidth` CJK 记 2 列、`padDisplay`、`renderAlignedRows`、`textBar`、`wrapDisplay`、`joinColumns`）。**这个模块一个符号都没从 `niceeval/report` 导出。** 于是 `docs-site/zh/guides/custom-reports.mdx`「换形态」现在明文教用户手搓：

```tsx
text({ rows }, { width }) {
  const bar = (n: number) => "█".repeat(Math.round(n * 10)).padEnd(10, "░");
  return rows.map((r) => `${r.key.padEnd(8)} ${…} ${r.display}`).join("\n");
}
```

三个缺陷，文档在教一个 bug：`String.prototype.padEnd` 数的是 **UTF-16 码元不是显示列宽**（agent 名/eval id 一带中文整张表就撕歪，而这正是本仓库最常见的场景）；列宽 `8` 硬编码，不随内容也不看 `ctx.width`；数字列**没法右对齐**——`renderAlignedRows` 现在除末列外一律左对齐，右对齐这个能力官方自己都没有。

「内置报告只是一份普通的用户报告」这条主张（`plan/built-in-reports-user-parity.md` 正在数据面兑现），在 text 面**目前不成立**。

**目标形态**，两层：

**第 1 层 —— `<Table>` 双面原语**（绝大多数「tab 一样的机制」就是一张表；与 Row / Col / Section / Text / Style 同级，没有特权）：

```tsx
<Table
  columns={[
    { key: "eval", header: "EVAL" },
    { key: "pass", header: "PASS", align: "right" },
    { key: "cost", header: "COST", align: "right" },
  ]}
  rows={[
    { key: "memory/foo", locator: "@160iuj3h",
      cells: { eval: "memory/foo", pass: "87%", cost: "$0.09" } },
    { key: "memory/bar",
      cells: { eval: "memory/bar", pass: null, cost: null } },   // null → 统一渲染 —
  ]}
/>
```

- **text 面**：列宽 = 该列最宽格的**显示宽度**（CJK 记 2 列），列间 3 空格，首行表头；`align: "right"` 按显示宽度右对齐（数字列可读的前提）。
- **web 面**：`<table>` + `<thead>`/`<tbody>`；右对齐落成 class 不是内联样式；`className` 照常可挂钩、配 `<Style>` 上样式。
- **缺数据 `null` → 渲染 `—`，不补 0**：两个面同源，与既有诚实契约一致。
- **超宽策略**：总宽超 `ctx.width` 时优先压最宽的**文本**列（折行），真放不下才截断并**如实标注剩余**——「截断报剩余」是既有契约，不在这里破例。
- **行可选带 `locator`**：带了就自动接证据室（text 面走 `ctx.attemptCommand`、web 面走 `ctx.attemptHref`），自定义表与官方表通同一间证据室。

**第 2 层 —— 文本排版工具箱，从 `niceeval/report` 导出**（表以外的形态仍要手写 text 面；逃生舱里必须有官方组件用的同一把尺子，否则「对等」是假的）：

| 导出 | 来源（`text/layout.ts`） | 为什么必须公开 |
|---|---|---|
| `stringWidth(text)` | `stringWidth` | **`.length` / `.padEnd` 一定会错的那一步**；不给它，用户的表遇中文必歪 |
| `padEnd` / `padStart` | `padDisplay` / `padStartDisplay` | 按显示宽度补齐;右对齐数字列靠 `padStart` |
| `wrapText(text, width)` | `wrapDisplay` | 按显示宽度折行 |
| `indent(block, prefix)` | `indentBlock` | 嵌套块缩进 |
| `bar(ratio, width)` | `textBar` | 字符条（文档里那个手搓 `"█".repeat(…)` 的正解） |
| `columns(blocks, widths, sep?)` | `joinColumns` | 多块并排 |

`renderAlignedRows` **不单独导出**：能力由 `<Table>` 承担，公开两条并行路径只会让作者选错。

**第 3 层 —— 官方组件重建在其上**（对等的构造证明）：`MetricTable` / `MetricMatrix` / `Scoreboard` / `DeltaTable` 四个表状组件的 text 面改走 `<Table>`。官方组件用不上的能力，用户就拿不到；官方绕过 `<Table>` 手搓，`<Table>` 就一定会长歪。`AttemptList` / `EvalList` / `ExperimentList` 三个实体列表保留各自的卡片 renderer——它们表达层级、展开与证据详情，是嵌套结构不是规则二维表，不为凑数字强塞进 `<Table>`。

**不在范围**：`src/show/render.ts`（证据室切片 `--execution` / `--eval` / `--diff`）不是报告组件，是 CLI 自己的渲染器，继续直接 import 内部 `layout.ts`。

**阶段**：

1. **文档定稿**（先文档后代码）：`docs/feature/reports/library.md` 写 `<Table>` props 契约与工具箱导出表；`docs-site/zh/guides/report-components.mdx`「排版原语」把清单改成 Row / Col / Section / Text / Style / **Table**，示例**必须含中文**（证明不歪）；`docs-site/zh/guides/custom-reports.mdx`「换形态」**删掉 `.padEnd(8)` 示例**、改成「表格用 `<Table>`，非表格用工具箱」两条路，补一句为什么不能用 `String.padEnd`。验收：`docs:validate` + `docs:links`（需 Node 22）。
2. **实现**：`renderAlignedRows` 加 per-column `align`（默认 left，不传时逐字节同旧输出）；`primitives.tsx` 实现 `Table` 双面组件（TSDoc 写全，参考页从 TSDoc 生成）；`report/index.ts` 导出 `Table` / `TableProps` + 工具箱六函数。测试加：**中文列宽**（`stringWidth` vs `.length` 的回归护栏）、`align: "right"`、`null → —`、超宽折行。验收：`pnpm run typecheck`、`pnpm test`、`pnpm docs:reference`。
3. **官方组件重建**：`MetricTable`、`MetricMatrix`、`Scoreboard`、`DeltaTable` 四个表状组件的 text 面改走 `<Table>`；`ExperimentList`、`EvalList`、`AttemptList` 三个实体列表保留卡片 renderer，不强塞进 `<Table>`——它们表达层级、展开与证据详情，不是规则二维表。`src/show/show.test.ts` 既有断言**不许改**——官方表输出应逐字节保持（右对齐是新增能力，不是把现有列改成右对齐；改视觉要另开裁决）。**实现完成的判定**：`src/report/text/faces.ts` 里 `tableText`/`matrixText`/`scoreboardText`/`deltaText` 均调用 `renderTableText`（`src/report/text/table.ts`），`experimentListText`/`evalListText`/`attemptListText` 各自走独立卡片渲染、不调用 `renderTableText`。
4. **真实冒烟**：在 `/Users/ctrdh/Code/coding-agent-memory-evals` 跑 `pnpm exec niceeval show` 冒烟，再写一个含中文列的自定义报告跑 `--report` 确认不歪。**真实冒烟完成的判定**独立于上一步的实现完成，由 `plan/docs-code-alignment-closeout.md` 第 2 节（「A 的中文 `<Table>` 真实冒烟」）单独跟踪验收，不在本文件重复勾选。

---

## B. Coding Agent 的 Skills / Plugins：文档定稿，代码是旧形状

**性质**：文档先行，代码欠账（不是漂移，不需要「以哪个为准」的裁决）。

**定稿契约**在 `docs/feature/adapters/coding-agent-skills-plugins.md`（commit `1dbc6b1`）：

- 跨 coding agent 共享的结构化 `SkillSpec`（本地 / repo 两种来源，可钉 `ref`，可只启用多 Skill 仓库里的一部分）；
- **不引入统一 `PluginSpec`**——Claude Code 与 Codex 各有各的 native plugin 契约（`ClaudeCodePluginSpec` / `CodexPluginSpec`，各自显式带 marketplace 的 name/source/ref 与 plugin name）；
- `McpServer` 独立成一类，不塞进 plugin 联合；
- Bub 专属 `PythonPluginSpec`；
- 安装结果落 `agent-setup.json`，已同步进 Results Format(`docs/feature/results/architecture.md`)与 Results 库(`library.md`)。

**代码现状**：`src/agents/claude-code.ts` 只有 `ClaudeCodeConfig.skills?: string[]`（只能表达 GitHub `org/repo`，setup 里跑 `npx skills add`），表达不了本地 Skill、钉 commit/tag、仓库内选择性启用；`agent-setup.json` 完全没有；Codex 侧只有 `mcpServers`。

**落点**：`src/agents/{claude-code,codex,bub}.ts` 的 config 类型与 setup；`src/agents/types.ts`（`SkillSpec` 的家）；`src/results/`（`agent-setup.json` 的写入与读取面）。类型要让无效组合**编译期**就不成立（Bub 收不到 MCP、Codex 收不到 Python plugin），不是运行时 fail fast。

**注意**：`memory/npx-skills-add-headless-hang.md`（`npx skills add` 在 headless 沙箱里默认交互式选 agent 会卡死，必须 `-y -a <agent>`）和 `memory/codex-no-native-skill-tool.md`（Codex 没有原生 skill 工具，装了也未必读）动手前必读。

---

## C. `src/` 注释里 85 处指向已不存在的文档

**性质**：文档重组（`docs/*.md` → `docs/feature/*/`）后留下的死指针。注释里指错路径比不指更糟——照着找的人会以为文档没了。

| 已不存在的路径 | 引用次数 | 现在的家 |
|---|---|---|
| `docs/reports.md` | 43 | `docs/feature/reports/{README,library,architecture,show,view}.md` |
| `docs/results-format.md` | 21 | `docs/feature/results/architecture.md` |
| `docs/results-lib.md` | 12 | `docs/feature/results/library.md` |
| `docs/view.md` | 4 | `docs/feature/reports/view.md` |
| `docs/scoring.md` | 3 | `docs/feature/scoring/README.md` |
| `docs/sandbox.md` | 2 | `docs/feature/sandbox/README.md` |

**不能盲 sed**：引用形如 ``docs/reports.md「宿主输入的组合语义」``，原 `reports.md` 的内容已按小节拆到 5 个文件里，得**逐条按小节名判断落到哪一份**。后五行的映射是 1:1 的，可以先批量处理；`docs/reports.md` 那 43 条要人工分派。

**顺手**：`docs/README.md` 的索引与 `test/docs-consistency.test.ts` 只看 `docs/` 内部链接，管不到 `src/` 注释——这批死链没有守护。收口后可考虑给一致性测试加一条「`src/` 注释里的 `docs/…md` 路径必须存在」，按仓库约定写成 `test/` 下的 vitest，不新增脚本。
