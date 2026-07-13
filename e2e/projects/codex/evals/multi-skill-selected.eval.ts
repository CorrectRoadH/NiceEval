import { defineEval } from "niceeval";
import { equals, isTrue, includes } from "niceeval/expect";

// 多 Skill 仓库选择性安装验收(plan/docs-code-alignment-closeout.md §3「测试矩阵要求」的
// "选择多 Skill 仓库中的指定 Skill"格)。与 claude-code 项目的同名 eval 对称:同一个
// anthropics/skills 仓库(固定 commit,真实含 18 个可选 Skill),agent config
// (codex-multi-skill.ts)只选了其中的 "template"。安装目录换成 codex 的
// `.agents/skills`,manifest 记录形状与 claude-code 侧完全一致(repo Skill 记录不分家)。
//
// 只验证「安装痕迹」,不对 send 后的行为做 shell 断言——codex 没有原生 Skill 工具,
// 是否真的读过 skill 文件属于 feature-skill-used.eval.ts(经 skillUsed())已经覆盖的
// 行为验收范围,这里的核心契约只是"选择性启用":只装了选中的,其余没被全装进来。
const REF = "9d2f1ae187231d8199c64b5b762e1bdf2244733d";
// 仓库里真实存在、但没被 skills 选中的另一个 Skill,用来验证"没选就没装"没有变成
// "全装再假装过滤"。
const UNSELECTED_SKILL = "pdf";

export default defineEval({
  description: "多 Skill 仓库选择性安装验收:agent-setup.json 的 skills[0].skills 恰好是选中集,未选中的 Skill 目录不存在",
  async test(t) {
    await t.group("安装痕迹:manifest 与磁盘选择性拷贝在 send 前就已就绪", async () => {
      const manifestRaw = await t.sandbox.readFile("__niceeval__/agent-setup.json");
      const manifest = JSON.parse(manifestRaw) as { skills?: unknown[] };
      t.check(manifest.skills?.length, equals(1));

      const first = manifest.skills?.[0] as
        | { kind?: string; source?: string; ref?: string; skills?: unknown }
        | undefined;
      t.check(first?.kind, equals("repo"));
      t.check(first?.source, equals("anthropics/skills"));
      t.check(first?.ref, equals(REF));
      // 恰好等于 ["template"]——不多(没把仓库其它 17 个 Skill 也塞进来)不少。
      t.check(JSON.stringify(first?.skills), equals(JSON.stringify(["template"])));

      // 选中的 Skill 真的落盘了。
      const selected = await t.sandbox.readFile(".agents/skills/template/SKILL.md");
      t.check(selected.length > 0, isTrue("selected skill 'template' has non-empty SKILL.md"));

      // codex 没有原生 Skill 发现机制,安装时必须把发现指引写进 AGENTS.md(见
      // src/agents/codex.ts installSkills 之后的 appendProjectInstruction);只应点名
      // 选中的 "template",不应点名未选中的 "pdf"。
      const agentsMd = await t.sandbox.readFile("AGENTS.md");
      t.check(agentsMd, includes(".agents/skills"));
      t.check(agentsMd, includes("template"));

      // 未选中的 Skill 目录不存在——这是"选择性启用"要验的核心契约,不是全装后台过滤。
      const unselectedDirCheck = await t.sandbox.runShell(`test -d .agents/skills/${UNSELECTED_SKILL}`);
      t.check(
        unselectedDirCheck.exitCode !== 0,
        isTrue(`unselected skill dir '.agents/skills/${UNSELECTED_SKILL}' must not exist`),
      );
    });

    // 便宜的收尾轮:证明 attempt 真的跑通了 agent,不产生额外 judge 成本;不对行为做
    // shell 断言(理由见上)。
    const turn = await t.send('Say "ok" and nothing else. Do not run any commands or read any files.');
    turn.expectOk();
    t.succeeded();
    t.noFailedActions();
  },
});
