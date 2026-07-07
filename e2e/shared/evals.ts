// e2e 共享 eval 套件:全部是参数化 factory,单一事实来源(见 docs/e2e-ci.md 第 3 节)。
// 断言逻辑改这里、全矩阵生效;各 SDK 的协议差异(工具名、usage、HITL 支持)只从 profile 进来。
// 提示词纪律沿用 tier1 的教训:不提"审批"二字(有的模型会改用文字反问而不发起工具调用),
// 对 coding agent 显式说明"不用跑命令"(否则纯问答也可能顺手探索工作目录)。
import { defineEval } from "niceeval";
import { equals, includes, excludes } from "niceeval/expect";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile } from "./profile.ts";

/** 正常问答 + 反调:不该动任何工具(coding agent 放宽为"没有失败的动作")。 */
export function basicQa(p: AgentProfile) {
  return defineEval({
    description: "正常问答;非 coding agent 兼验证不瞎调工具(反调)",
    async test(t) {
      const prompt = p.sandboxTools
        ? "1+1 等于几?用一句话回答就好,不用跑命令也不用建文件。"
        : "用一句话介绍一下你自己,这轮不用查天气也不用算数。";
      const turn = await t.send(prompt);
      turn.expectOk();
      t.succeeded();

      if (p.sandboxTools) {
        // Codex 这类自主编码 agent 即使纯问答也可能顺手探索目录,不强断言零工具。
        t.noFailedActions();
        t.messageIncludes("2");
      } else {
        t.usedNoTools();
        if (p.weatherToolName) t.notCalledTool(p.weatherToolName);
        t.judge.autoevals.closedQA("助手是否用一两句话正常介绍了自己,而不是报错或答非所问?").gate(0.6);
      }

      if (p.usage) t.maxTokens(40_000);
    },
  });
}

/** 正调:天气提问必须触发天气工具且城市参数正确;顺带反调计算器。 */
export function weatherTool(p: AgentProfile) {
  if (!p.weatherToolName) throw new Error("weatherTool eval requires profile.weatherToolName");
  const weather = p.weatherToolName;
  return defineEval({
    description: "天气提问正确调用天气工具并基于结果作答(正调)",
    async test(t) {
      const turn = await t.send("北京今天天气怎么样?");
      turn.expectOk();

      await t.group("调用天气工具且城市正确", () => {
        t.calledTool(weather, { input: { city: "北京" } });
        t.messageIncludes(/°C|气温|天气|晴|多云|雨|阴/);
      });
      if (p.calcToolName) t.notCalledTool(p.calcToolName);

      t.judge.autoevals
        .closedQA("助手是否给出了具体的天气数据(温度或天气状况),而不是拒绝回答或含糊其辞?")
        .atLeast(0.7);
    },
  });
}

/** HITL 批准分支:approve 之后工具正常执行,status 是 "completed"。 */
export function hitlApprove(p: AgentProfile) {
  if (!p.calcToolName) throw new Error("hitlApprove eval requires profile.calcToolName");
  const calc = p.calcToolName;
  return defineEval({
    description: "HITL:计算器经批准后正常执行",
    async test(t) {
      const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
      t.check(draft.status, equals("waiting"));

      t.requireInputRequest({ action: calc });

      const approved = await t.respond("approve");
      approved.succeeded();
      t.calledTool(calc, { status: "completed" });
      t.messageIncludes(/126/);
    },
  });
}

/** HITL 拒绝分支:人否决落 "rejected" 而不是 "failed";模型不死心重试时 deny 到放弃为止。 */
export function hitlDeny(p: AgentProfile) {
  if (!p.calcToolName) throw new Error("hitlDeny eval requires profile.calcToolName");
  const calc = p.calcToolName;
  return defineEval({
    description: "HITL:计算器被拒绝后标记 rejected 而不是 failed",
    async test(t) {
      await t.send("用计算器算一下 (23+19)*3 等于多少");
      t.requireInputRequest({ action: calc });

      let denied = await t.respond("deny");
      for (let attempt = 0; attempt < 3 && denied.status === "waiting"; attempt++) {
        denied = await t.respond("deny");
      }
      t.check(denied.status, equals("completed"));
      t.calledTool(calc, { status: "rejected" });
      t.noFailedActions();
    },
  });
}

/** 跨轮记忆两半承诺:同一会话线记得住,newSession() 不共享历史。纯口头事实,不受磁盘状态干扰。 */
export function sessionIsolation(p: AgentProfile) {
  const suffix = p.sandboxTools ? "这轮不用跑命令也不用建文件。" : "";
  return defineEval({
    description: "跨轮记忆与 newSession() 隔离",
    async test(t) {
      await t.send(`我叫小明,帮我记住这个名字。${suffix}`);
      const recall = await t.send(`我刚才说我叫什么名字?${suffix}`);
      recall.messageIncludes("小明");
      t.check(t.reply, includes("小明"));

      const fresh = t.newSession();
      await fresh.send(`我叫什么名字?${suffix}`);
      t.check(fresh.reply, excludes("小明"));
    },
  });
}

/** coding agent 本分:在工作目录里写一个真实文件,跑完直接读磁盘双重核实。 */
export function createFile(p: AgentProfile) {
  if (!p.sandboxTools || !p.workspaceDir) throw new Error("createFile eval requires profile.workspaceDir");
  const target = join(p.workspaceDir, "niceeval-e2e-create-file.txt");
  const marker = "niceeval-e2e-marker-926";
  return defineEval({
    description: "在工作目录里创建一个内容正确的真实文件",
    async test(t) {
      rmSync(target, { force: true });

      const turn = await t.send(
        `在当前工作目录创建一个文件 niceeval-e2e-create-file.txt,内容只写一行:${marker}`,
      );
      turn.expectOk();
      t.succeeded();
      t.noFailedActions();

      // 文件不存在按空内容断言:"没写出文件"是这条 eval 要测的 failed,不是框架 errored。
      const content = existsSync(target) ? readFileSync(target, "utf8") : "";
      t.check(content, includes(marker));
    },
  });
}

/** coding agent 真的跑 shell 命令(而不是凭空回答)。 */
export function runCommand(p: AgentProfile) {
  if (!p.sandboxTools) throw new Error("runCommand eval requires profile.sandboxTools");
  return defineEval({
    description: "在工作目录里跑一个真实 shell 命令",
    async test(t) {
      const turn = await t.send("在当前工作目录跑 `echo niceeval-e2e-run-926`,把命令的输出告诉我。");
      turn.expectOk();

      await t.group("调用了 shell 且没有失败的动作", () => {
        t.calledTool("command_execution", { status: "completed" });
        t.noFailedActions();
      });

      t.messageIncludes("niceeval-e2e-run-926");
    },
  });
}
