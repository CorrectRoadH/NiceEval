import { Template } from "e2b";
import {
  e2bCodingAgentTemplate,
  type E2BCodingAgent,
} from "niceeval/sandbox/e2b-template";

const [agent, alias] = process.argv.slice(2) as [E2BCodingAgent | undefined, string | undefined];
if (!agent || !["claude-code", "codex", "bub"].includes(agent) || !alias) {
  throw new Error(
    "用法: pnpm tsx sandbox/e2b/build-agent-template.mts <claude-code|codex|bub> <template-alias>",
  );
}

// 在 build 前继续链 .aptInstall() / .runCmd() / .copy()，即可把项目依赖叠加在官方起点上。
const template = e2bCodingAgentTemplate(agent)
  .runCmd("git --version && node --version");

await Template.build(template, alias, { cpuCount: 2, memoryMB: 4096 });
console.log(`built ${agent} template: ${alias}`);
