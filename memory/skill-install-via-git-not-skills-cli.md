# repo skill 安装改走 git clone，不用 `npx skills add`；native plugin 安装未经真机验证

**设计裁决**(2026-07-12,实现结构化 `SkillSpec` 时)。

**曾选方案**:沿用旧实现的 `npx skills add <org/repo> -y -a <agent>`。

**否决理由**:定稿契约要求两件 `skills` CLI 给不了的事——
① **钉 ref**(tag / commit / branch):CLI 没有任何传 ref 的入口;
② **多 skill 仓库里显式选一部分,选不中要报出可选集**:CLI 的 `-l` 只吐带 ANSI 的人看清单,没有机器可读输出,枚举不了「这个 repo 里有哪些 skill」。

**现方案**:`src/agents/skills.ts` 直接走 git —— clone(给了 `ref` 就全量 clone 再 `checkout <ref>`)→ `find SKILL.md` 枚举 → 按 `skills?` 选择规则挑 → `cp -R` 进各 agent 的 skill 目录(claude-code `.claude/skills/<name>`,codex / bub `.agents/skills/<name>`,与旧实现落点一致)。
**顺带收益**:整类绕开了 [[npx-skills-add-headless-hang]]——不再依赖那个默认交互式的 CLI。

**尚未真机验证(只有类型 + 单测覆盖)**:沙箱里的真实安装路径一条都没跑过(要 Docker + API key)。风险最高的两处——

1. **`claude plugin install` 在无 tty 沙箱里可能弹信任/确认提示**:它的 `--help` 里**没有** `-y` / `--yes`。若真会弹,就是与 [[npx-skills-add-headless-hang]] **同一类**的 headless 卡死(卡到 attempt 超时,不报错)。真机第一次跑 plugin 相关 eval 时优先盯这里。
2. **`codex plugin list --json` 的输出形状是猜的**:用来回读 `resolvedVersion`。解析写得宽容(取不到就省略该字段,不阻断安装),所以最坏情况只是 manifest 里少一个版本号。

关联:[[npx-skills-add-headless-hang]]、[[codex-no-native-skill-tool]]、
[[claude-code-skill-tool-name-not-load-skill]](断言侧怎么验 skill 真的被用了)。
