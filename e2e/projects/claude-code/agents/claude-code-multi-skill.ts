// multi-skill 实验专用:同一个 claude-code adapter,挂一个真正的多 Skill Repo
// (anthropics/skills,固定 commit,repo 里同时含 17 个 skills/* 子目录 + 顶层 template/
// 共 18 个可选 Skill),用 `skills: ["template"]` 只选其中一个。只挂这一个 repo Skill,
// 不挂 MCP、不挂 local Skill——把「选择多 Skill 仓库中的指定 Skill」单独隔离出来验证,
// 不与 claude-code-features.ts(Effect-TS/skills,单 Skill repo,省略 skills 走默认单选
// 分支)混在一起,那条路径测的是「省略选择集」,这里测的是「显式选择子集」。
//
// 选 "template" 而不是 "pdf"/"docx" 等:仓库里唯一一个只有单个 SKILL.md、零附件脚本、
// 零第三方系统依赖的 Skill(见 template/SKILL.md),内容最轻、没有 pip 包一类的验证负担——
// 这条 e2e 只验证「装没装、装的是不是恰好这一个」,不执行 Skill 里的操作,选最轻的即可。
import { claudeCodeAgent } from "niceeval/adapter";

export default claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  skills: [{
    kind: "repo",
    source: "anthropics/skills",
    ref: "9d2f1ae187231d8199c64b5b762e1bdf2244733d",
    skills: ["template"],
  }],
});
