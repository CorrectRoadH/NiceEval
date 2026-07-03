import { defineEval } from "niceeval";

// 这条 eval 验证 agent 会真的跑 shell 命令(而不是凭空回答)。工具事件由 otel.codex 方言
// 从 codex 原生 span 派生,工具名是 span 上的 codex 内部名 `exec_command`
// (不是 ThreadEvent item 的 `command_execution`——两套命名来自 codex 的不同层)。
export default defineEval({
  description: "测试 agent 能在工作目录里跑一个真实 shell 命令",

  async test(t) {
    const turn = await t.send("在当前工作目录跑 `echo niceeval-run-command-926`,把命令的输出告诉我。");
    turn.expectOk();

    await t.group("调用了 shell 且没有失败的动作", () => {
      t.calledTool("exec_command", { status: "completed" });
      t.noFailedActions();
    });

    t.messageIncludes("niceeval-run-command-926");
  },
});
