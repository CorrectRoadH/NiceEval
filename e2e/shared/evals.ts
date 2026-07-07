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
        // city 用正则:模型传 "北京市" 也算对,别把语言习惯差异判成回归。
        t.calledTool(weather, { input: { city: /北京/ } });
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
      // 反证门控真拦住了执行:批准前不允许出现计算器的"已完成"结果,否则"先执行、
      // 事后补问审批"的实现也能骗过下面的正向断言。注意不能用 notCalledTool
      // (status:"completed"):派生事实对"已发起还没结果"的调用乐观默认 completed,
      // 只有对原始事件流查 action.result 才能表达"还没执行"。
      draft.eventsSatisfy((events) => {
        const calcIds = new Set(
          events.filter((e) => e.type === "action.called" && e.name === calc).map((e) => e.callId),
        );
        return !events.some(
          (e) => e.type === "action.result" && calcIds.has(e.callId) && e.status === "completed",
        );
      }, "no completed calculator result before approval");

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
      // deny 的核心语义是"从未真正执行":只断言"存在 rejected"拦不住"照跑了但补标
      // rejected"的坏实现,必须整个会话里都没有已完成的计算器调用。
      t.notCalledTool(calc, { status: "completed" });
      t.noFailedActions();
    },
  });
}

/** 工具执行失败被如实标记 failed:7/0 每个 app 的 calculate 都必然报错,协议层不许吞成
 *  completed,也不许炸掉整轮;模型看到错误要如实作答而不是编造数字。计算器经审批门控,
 *  所以走一次 approve 才能触发真实执行。 */
export function toolFailure(p: AgentProfile) {
  if (!p.calcToolName) throw new Error("toolFailure eval requires profile.calcToolName");
  const calc = p.calcToolName;
  return defineEval({
    description: "工具执行失败映射成 failed 状态,agent 恢复作答而不是编造结果",
    async test(t) {
      await t.send("用计算器算一下 7/0,把表达式原样交给工具;如果工具报错,不要换别的表达式重试,直接告诉我失败原因。");
      t.requireInputRequest({ action: calc });

      let turn = await t.respond("approve");
      // 模型不听话重试新表达式时会再次触发审批:deny 到它放弃为止,保证最终收轮。
      for (let attempt = 0; attempt < 3 && turn.status === "waiting"; attempt++) {
        turn = await t.respond("deny");
      }
      t.check(turn.status, equals("completed"));

      await t.group("失败如实落 failed,没有成功执行混进来", () => {
        t.calledTool(calc, { status: "failed" });
        t.notCalledTool(calc, { status: "completed" });
      });

      t.judge.autoevals
        .closedQA("助手是否如实说明这次计算失败或无法计算(除以零),而没有编造一个具体的数值结果?")
        .gate(0.6);
    },
  });
}

/** 跨轮记忆两半承诺:同一会话线记得住,newSession() 不共享历史。纯口头事实,不受磁盘状态干扰。 */
export function sessionIsolation(p: AgentProfile) {
  const suffix = p.sandboxTools ? "这轮不用跑命令也不用建文件。" : "";
  return defineEval({
    description: "跨轮记忆与 newSession() 隔离",
    async test(t) {
      (await t.send(`我叫小明,帮我记住这个名字。${suffix}`)).expectOk();
      const recall = await t.send(`我刚才说我叫什么名字?${suffix}`);
      recall.expectOk();
      recall.messageIncludes("小明");

      // 反面半场必须先证明这一轮真的跑成了:没有 expectOk 的话,新会话直接报错、
      // 回复是空串,excludes 对空串恒真,"隔离通过"就成了空洞结论。
      const fresh = t.newSession();
      (await fresh.send(`我叫什么名字?${suffix}`)).expectOk();
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
        // marker 就写在提示词里,光看回复文本分不清"真跑了"和"照抄提示词"——
        // 必须对到 command 入参:确实执行过带这个 marker 的命令。
        t.calledTool("command_execution", { status: "completed", input: { command: /niceeval-e2e-run-926/ } });
        t.noFailedActions();
      });

      t.messageIncludes("niceeval-e2e-run-926");
    },
  });
}
