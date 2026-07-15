// cases: docs/engineering/unit-tests/adapters/cases.md
// 编译期类型测试:证明 Claude Code / Codex / Bub 的 Config 只能收各自合法的扩展组合——
// 不支持的能力在类型层就不存在,不留到运行期 fail fast(定稿见
// docs/feature/adapters/architecture/coding-agent-extensions.md「类型边界」)。
//
// 断言机制:每个 `@ts-expect-error` 断言「紧跟的这一行编译不过」。这些断言全部装在从不在
// 运行时调用的函数体里——`tsc --noEmit`(`pnpm run typecheck`)本就会类型检查未执行到的函数
// 体,不需要真的跑起来。断言是自证的:如果这一行其实编译得过,tsc 会反过来报
// "Unused '@ts-expect-error' directive",本文件本身就不再通过 typecheck,不会有「断言写错、
// 静默失效」的中间状态。风格参照 src/report/dual-render.test.tsx 的
// metricScatterPropsTypeChecks:整段包一个从不调用的函数,文件末尾 `void` 掉避免「未使用」噪音。
//
// 覆盖范围以真实类型定义为准(先读了 claude-code.ts / codex.ts / bub.ts 的 Config 接口,
// 不是凭空假设字段名):
// - BubConfig 没有 mcpServers / plugins 字段——MCP 与 native plugin 只属于 Claude Code / Codex。
// - ClaudeCodeConfig / CodexConfig 没有 pythonPlugins 字段——那是 Bub 专属。
// - PythonPluginSpec(`{ package }`)与 ClaudeCodePluginSpec / CodexPluginSpec
//   (`{ marketplace, name }`)形状不同:塞错位置(PythonPluginSpec 塞进 `plugins`,或反过来把
//   plugin spec 塞进 `pythonPlugins`)编译不过。
//
// **刻意不覆盖**:ClaudeCodePluginSpec ↔ CodexPluginSpec 互相塞进对方的 `plugins` 字段。
// 两者当前字段形状完全相同(`{ marketplace: { name, source, ref? }, name }`),结构类型系统
// 判不出「这是哪家的 Marketplace」——这是文档已裁决的非目标,见
// coding-agent-skills-plugins.md 设计规则 5 第二段:「类型系统不负责拦住『把只有 Codex 能读的
// Marketplace 递给 Claude Code』:那是 source 字段的值不合法,不是形状不合法,任何结构类型
// 系统都判不出来」。实测(见本文件同目录下 claude-code.test.ts / codex.test.ts 的开发过程)
// 直接给这个组合写 `@ts-expect-error` 会被 tsc 判成 "Unused directive"(因为它其实编译得过),
// 写这条断言本身就会让 `pnpm run typecheck` 失败——所以这里不写这一条,归属改由 Adapter 在
// 运行期按 `source` 值报错(见 claude-code.ts / codex.ts 的 installPlugins 失败语义)。

import { describe, expect, it } from "vitest";
import { claudeCodeAgent, type ClaudeCodeConfig } from "./claude-code.ts";
import { codexAgent, type CodexConfig } from "./codex.ts";
import { bubAgent, type BubConfig, type PythonPluginSpec } from "./bub.ts";
import type { McpServer } from "../types.ts";

/** BubConfig 没有 mcpServers / plugins 字段:两者只属于 Claude Code / Codex。 */
function bubConfigRejectsForeignExtensions(mcp: McpServer, python: PythonPluginSpec): void {
  // 合法组合先落一遍,证明下面的报错真是因为多出的字段,不是因为 pythonPlugins 本身就不合法。
  const legal: BubConfig = { pythonPlugins: [python] };
  void legal;

  // @ts-expect-error BubConfig 没有 mcpServers 字段——MCP 只属于 Claude Code / Codex。
  bubAgent({ mcpServers: [mcp] });

  // @ts-expect-error BubConfig 没有 plugins 字段——native plugin 只属于 Claude Code / Codex。
  bubAgent({ plugins: [{ marketplace: { name: "acme", source: "x" }, name: "y" }] });
}

/** ClaudeCodeConfig / CodexConfig 没有 pythonPlugins 字段:那是 Bub 专属。 */
function codingAgentConfigsRejectPythonPlugins(python: PythonPluginSpec): void {
  // @ts-expect-error CodexConfig 没有 pythonPlugins 字段——那是 Bub 专属(PythonPluginSpec)。
  codexAgent({ pythonPlugins: [python] });

  // @ts-expect-error ClaudeCodeConfig 没有 pythonPlugins 字段——那是 Bub 专属。
  claudeCodeAgent({ pythonPlugins: [python] });
}

/** PythonPluginSpec 形状(`{ package }`)塞不进要求 `{ marketplace, name }` 的 native plugin 字段。 */
function nativePluginFieldsRejectPythonShape(python: PythonPluginSpec): void {
  // @ts-expect-error PythonPluginSpec 缺 ClaudeCodePluginSpec 要求的 marketplace/name,形状不合法。
  claudeCodeAgent({ plugins: [python] });

  // @ts-expect-error 同上,Codex 侧(CodexPluginSpec 同样要求 marketplace/name)。
  codexAgent({ plugins: [python] });
}

void bubConfigRejectsForeignExtensions;
void codingAgentConfigsRejectPythonPlugins;
void nativePluginFieldsRejectPythonShape;

describe("Agent Config 的编译期类型边界", () => {
  it("正控:各自合法的配置组合能正常构造(证明上面的 @ts-expect-error 不是因为字段名打错才生效)", () => {
    const claudeConfig: ClaudeCodeConfig = {
      skills: [{ kind: "local", path: "skills/effect-ts/SKILL.md" }],
      plugins: [
        { marketplace: { name: "acme", source: "acme/claude-code-plugins", ref: "v1.3.0" }, name: "safe-shell" },
      ],
      mcpServers: [{ name: "browser", command: "npx", args: ["-y", "@modelcontextprotocol/server-browser"] }],
    };
    const codexConfig: CodexConfig = {
      skills: [{ kind: "repo", source: "Effect-TS/skills", ref: "8f3c1a2", skills: ["effect"] }],
      plugins: [{ marketplace: { name: "acme", source: "acme/codex-plugins", ref: "8f3c1a2" }, name: "repo-map" }],
      mcpServers: [{ name: "browser", command: "npx" }],
    };
    const bubConfig: BubConfig = {
      skills: [{ kind: "local", path: "skills/effect-ts/SKILL.md" }],
      pythonPlugins: [{ package: "bub-plugin-memory==1.3.0" }],
    };

    expect(claudeCodeAgent(claudeConfig).name).toBe("claude-code");
    expect(codexAgent(codexConfig).name).toBe("codex");
    expect(bubAgent(bubConfig).name).toBe("bub");
  });
});
