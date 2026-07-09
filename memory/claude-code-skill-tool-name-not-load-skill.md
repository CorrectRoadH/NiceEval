# claude-code 的原生 Skill 工具叫 `Skill`,不是 `load_skill`;`t.loadedSkill()` 断不中

**现象**：给 `claudeCodeAgent` 装了一个真实 skill(`Effect-TS/skills`)、发一句会触发它的提示词,
`t.loadedSkill("effect-ts")` 断言仍然失败(0 分),即使从回复内容看模型明显读过 skill 文件。

**根因**：`t.loadedSkill(skill)` 是 `t.calledTool("load_skill", { input: { skill } })` 的语法糖
(`src/scoring/scoped.ts`),这是为 eve 协议量身定的糖——eve 的 action kind 真的叫 `load-skill`
(见 `docs/adapters/reference/eve-protocol.md`)。claude-code CLI 的原生工具用的是完全不同的名字
`Skill`(首字母大写),入参形状是 `{ skill: "<id>", args: "<自然语言摘要>" }`,`calledTool` 按
`tc.name === name || tc.originalName === name` 匹配(`src/scoring/scoped.ts` 的 `toolMatches`),
"load_skill" 两边都对不上 claude-code 的 "Skill"。

实测(Docker 沙箱,`claude --print --dangerously-skip-permissions`,装了 `Effect-TS/skills` 后问
Effect 的 Layer 用法):transcript 里的 tool_use 是
`{"name":"Skill","input":{"skill":"effect-ts","args":"..."}}`,随后跟一次
`Read` 读 `.claude/skills/effect-ts/references/guide-layers.md`。

**修法**(使用侧结论,不是要去改 `loadedSkill` 本身——它对 eve 仍然是对的语义):
claude-code / codex 这类沙箱型 agent 的 skill 断言直接写
`t.calledTool("Skill", { input: { skill: "effect-ts" } })`,不要用 `t.loadedSkill()`。
落点：`e2e/shared/evals.ts` 的 `skillUsed(p)` factory(`profile.skillDetection === "tool"` 分支)。
适用场景:任何要断言"claude-code 真的用了某个 skill"的 eval。

关联:[[npx-skills-add-headless-hang]](同一次调研)、
[[codex-no-native-skill-tool]](codex 那边完全没有对应工具,情况更极端)。
