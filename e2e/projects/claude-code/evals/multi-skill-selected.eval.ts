import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

// 多 Skill 仓库选择性安装验收(plan/docs-code-alignment-closeout.md §3「测试矩阵要求」的
// "选择多 Skill 仓库中的指定 Skill"格)。仓库 anthropics/skills(固定 commit)真实含 18 个
// 可选 Skill,agent config(claude-code-multi-skill.ts)只选了其中的 "template"。
//
// 和 local-skill-used.eval.ts 同一纪律:只验证「安装痕迹」(agent-setup.json manifest +
// 磁盘选择性拷贝的结果),不对 send 后的模型行为做 calledTool 断言——Claude Code 原生
// Skill 工具在本仓库 e2e 默认模型(deepseek-v4-flash 经代理)下不会自动触发
// (memory/skill-install-via-git-not-skills-cli.md),行为断言只会抖动出假失败,
// 这条 e2e 的核心契约是"选择性启用"本身:只装了选中的,其余没被全装进来。
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
      const selected = await t.sandbox.readFile(".claude/skills/template/SKILL.md");
      t.check(selected.length > 0, isTrue("selected skill 'template' has non-empty SKILL.md"));

      // 未选中的 Skill 目录不存在——这是"选择性启用"要验的核心契约,不是全装后台过滤。
      const unselectedDirCheck = await t.sandbox.runShell(`test -d .claude/skills/${UNSELECTED_SKILL}`);
      t.check(
        unselectedDirCheck.exitCode !== 0,
        isTrue(`unselected skill dir '.claude/skills/${UNSELECTED_SKILL}' must not exist`),
      );
    });

    // 便宜的收尾轮:证明 attempt 真的跑通了 agent,不产生额外 judge 成本;不对行为做
    // calledTool 断言(理由见上)。
    const turn = await t.send('Say "ok" and nothing else. Do not run any commands or read any files.');
    turn.expectOk();
    t.succeeded();
    t.noFailedActions();
  },
});
