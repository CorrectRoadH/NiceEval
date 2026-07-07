// AgentProfile:每个 e2e 项目声明自己的协议现实(工具名、能力开关)。
// 共享 eval/experiment 都是 factory,吃 profile 决定断言口径——SDK 间的差异只允许
// 出现在各项目的 profile.ts 里,不允许出现在共享套件的断言逻辑里(见 docs/e2e-ci.md 第 3 节)。
export interface AgentProfile {
  /** 天气工具在该 SDK 协议里的真实名字(claude-sdk 是 MCP 命名空间名);coding agent 没有则为 null。 */
  weatherToolName: string | null;
  /** 经审批门控的计算器工具名;不支持 HITL(codex-sdk)则为 null。 */
  calcToolName: string | null;
  /** 协议是否携带 usage(决定是否断言 maxTokens;UI Message Stream / langgraph 自定义帧没有)。 */
  usage: boolean;
  /** 是否是"目录里的编码 agent"(决定 create-file / run-command 是否生效、问答是否强断言零工具)。 */
  sandboxTools: boolean;
  /** coding agent 的工作目录绝对路径(sandboxTools: true 时必填,eval 直接读磁盘核实)。 */
  workspaceDir?: string;
}
