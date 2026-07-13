// multi-skill 实验专用:codex 版镜像 claude-code-multi-skill.ts——同一个 codex adapter,
// 挂同一个真正的多 Skill Repo(anthropics/skills,固定 commit,18 个可选 Skill),用
// `skills: ["template"]` 只选其中一个。选 "template" 的理由同 claude-code 侧注释:仓库里
// 内容最轻、零系统依赖的 Skill,这条 e2e 只验证安装选择集,不执行 Skill 内容。
import { codexAgent } from "niceeval/adapter";

export default codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  skills: [{
    kind: "repo",
    source: "anthropics/skills",
    ref: "9d2f1ae187231d8199c64b5b762e1bdf2244733d",
    skills: ["template"],
  }],
});
