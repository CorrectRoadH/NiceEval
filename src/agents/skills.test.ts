// cases: docs/engineering/unit-tests/adapters/cases.md
// SkillSpec 安装的单测:本地形状(目录 / 单文件 / 不支持)、repo 的 ref 钉定与选择规则、
// manifest 记录形状、以及「setup 装进 workspace 的东西不算 agent diff」这条护栏。
// 沙箱是内存 fake(记命令 + 记文件),不起容器:这里要验的是 adapter 侧的翻译规则,
// 不是 provider 的执行。

import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkills, installedSkillNames, skillDiscoveryInstruction } from "./skills.ts";
import { AGENT_SETUP_MANIFEST_PATH, readAgentSetupManifest, writeAgentSetupManifest } from "./manifest.ts";
import type { CommandResult, Sandbox, SandboxFile } from "../types.ts";

/** 内存沙箱:runShell 记命令(可按前缀脚本化输出),writeFiles/uploadFiles 记文件。 */
class FakeSandbox implements Partial<Sandbox> {
  readonly workdir = "/workspace";
  readonly sandboxId = "fake";
  readonly otlpHost = null;
  readonly commands: string[] = [];
  readonly files = new Map<string, string>();
  /** 命令 → 输出(按命令算,因为 clone 目录是随机的);没命中就是 exit 0、空输出。 */
  script: { match: string; result: (cmd: string) => Partial<CommandResult> }[] = [];

  async runShell(script: string): Promise<CommandResult> {
    this.commands.push(script);
    const hit = this.script.find((s) => script.includes(s.match));
    return { stdout: "", stderr: "", exitCode: 0, ...hit?.result(script) };
  }
  async writeFiles(files: Record<string, string>, targetDir?: string): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(targetDir ? `${targetDir}/${path}` : path, content);
    }
  }
  async uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void> {
    for (const f of files) {
      this.files.set(targetDir ? `${targetDir}/${f.path}` : f.path, f.content.toString());
    }
  }
  async fileExists(): Promise<boolean> {
    return false;
  }
  async readFile(path: string): Promise<string> {
    const hit = this.files.get(path);
    if (hit === undefined) throw new Error(`no such file: ${path}`);
    return hit;
  }
}

const sb = (s?: FakeSandbox["script"]): FakeSandbox => {
  const box = new FakeSandbox();
  if (s) box.script = s;
  return box;
};
const asSandbox = (box: FakeSandbox): Sandbox => box as unknown as Sandbox;

async function skillProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-skills-"));
  await mkdir(join(root, "skills", "effect-ts"), { recursive: true });
  await writeFile(join(root, "skills", "effect-ts", "SKILL.md"), "# Effect\nuse Effect\n", "utf-8");
  await writeFile(join(root, "skills", "effect-ts", "reference.md"), "layers\n", "utf-8");
  await writeFile(join(root, "skills", "repository-guide.md"), "# Repo guide\n", "utf-8");
  await mkdir(join(root, "skills", "broken"), { recursive: true });
  await writeFile(join(root, "skills", "broken", "notes.md"), "no SKILL.md here\n", "utf-8");
  return root;
}

describe("installSkills · 本地 Skill", () => {
  it("目录形态按原样上传(名字取目录名),单文件形态落成 <name>/SKILL.md(SKILL.md 取所在目录名);manifest 记 sha256", async () => {
    const root = await skillProject();
    try {
      const box = sb();
      const skills = await installSkills(
        asSandbox(box),
        [
          { kind: "local", path: "skills/effect-ts" },
          { kind: "local", path: "skills/effect-ts/SKILL.md" },
          { kind: "local", path: "skills/repository-guide.md", name: "repo-guide" },
        ],
        { dir: ".claude/skills", projectRoot: root },
      );

      expect(skills.map((s) => s.kind === "local" && s.name)).toEqual(["effect-ts", "effect-ts", "repo-guide"]);
      expect(box.files.get(".claude/skills/effect-ts/SKILL.md")).toContain("use Effect");
      expect(box.files.get(".claude/skills/effect-ts/reference.md")).toBe("layers\n");
      expect(box.files.get(".claude/skills/repo-guide/SKILL.md")).toBe("# Repo guide\n");
      // sha256 是内容哈希:目录(两个文件)与单文件(只有 SKILL.md)不是同一份内容 → 不同哈希
      const hashes = skills.map((s) => (s.kind === "local" ? s.sha256 : ""));
      expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(hashes[0]).not.toBe(hashes[1]);
      // setup 装进 workspace 的目录排除出 agent diff(git 基线早于 agent.setup)
      expect(box.commands.some((c) => c.includes(".git/info/exclude") && c.includes(".claude/skills/"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("路径不存在 / 目录里没有 SKILL.md / 不是 .md 文件:setup 失败并说明原因", async () => {
    const root = await skillProject();
    try {
      await expect(
        installSkills(asSandbox(sb()), [{ kind: "local", path: "skills/nope" }], { dir: ".claude/skills", projectRoot: root }),
      ).rejects.toThrow(/does not exist|不存在/);

      await expect(
        installSkills(asSandbox(sb()), [{ kind: "local", path: "skills/broken" }], { dir: ".claude/skills", projectRoot: root }),
      ).rejects.toThrow(/SKILL\.md/);

      await expect(
        installSkills(asSandbox(sb()), [{ kind: "local", path: "skills/broken/notes.txt" }], {
          dir: ".claude/skills",
          projectRoot: root,
        }),
      ).rejects.toThrow(/does not exist|不存在/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("installSkills · repo Skill", () => {
  /** clone 目录是随机的:find 的假输出从命令里把它抠出来再拼 SKILL.md 路径。 */
  const cloneDirOf = (cmd: string): string => /find '([^']+)'/.exec(cmd)![1]!;
  // repo 根就有 SKILL.md → 整个 repo 是一个 skill(名字取 repo 名)
  const oneSkill = [{ match: "find", result: (cmd: string) => ({ stdout: `${cloneDirOf(cmd)}/SKILL.md\n` }) }];
  // 多 skill repo:每个含 SKILL.md 的目录一个
  const manySkills = [
    {
      match: "find",
      result: (cmd: string) => ({
        stdout: `${cloneDirOf(cmd)}/skills/effect/SKILL.md\n${cloneDirOf(cmd)}/skills/effect-sql/SKILL.md\n`,
      }),
    },
  ];

  it("repo 只有一个 skill、省略 skills:装唯一那个(名字取 repo 名);ref 钉定走完整 clone + checkout", async () => {
    const box = sb(oneSkill);
    const skills = await installSkills(
      asSandbox(box),
      [{ kind: "repo", source: "Effect-TS/skills", ref: "8f3c1a2" }],
      { dir: ".agents/skills" },
    );

    expect(skills).toEqual([{ kind: "repo", source: "Effect-TS/skills", ref: "8f3c1a2", skills: ["skills"] }]);
    const clone = box.commands.find((c) => c.includes("git clone"))!;
    expect(clone).toContain("https://github.com/Effect-TS/skills.git");
    expect(clone).not.toContain("--depth 1"); // 任意 commit checkout 不到浅克隆里
    expect(clone).toContain("checkout --quiet '8f3c1a2'");
    expect(box.commands.some((c) => c.includes("cp -R") && c.includes(".agents/skills/skills"))).toBe(true);
  });

  it("省略 ref → 浅克隆;repo 有多个 skill 而没给 skills → 失败并列出可选集", async () => {
    const box = sb(oneSkill);
    await installSkills(asSandbox(box), [{ kind: "repo", source: "Effect-TS/skills" }], { dir: ".agents/skills" });
    expect(box.commands.find((c) => c.includes("git clone"))).toContain("--depth 1");

    await expect(
      installSkills(asSandbox(sb(manySkills)), [{ kind: "repo", source: "Effect-TS/skills" }], { dir: ".agents/skills" }),
    ).rejects.toThrow(/effect, effect-sql/);
  });

  it("选中的 skill 不存在 → 失败并报 source / ref / 可选集;选中子集 → 只装选中的", async () => {
    await expect(
      installSkills(
        asSandbox(sb(manySkills)),
        [{ kind: "repo", source: "Effect-TS/skills", ref: "v1", skills: ["effect", "nope"] }],
        { dir: ".agents/skills" },
      ),
    ).rejects.toThrow(/nope/);

    const box = sb(manySkills);
    const skills = await installSkills(
      asSandbox(box),
      [{ kind: "repo", source: "Effect-TS/skills", skills: ["effect"] }],
      { dir: ".agents/skills" },
    );
    expect(skills).toEqual([{ kind: "repo", source: "Effect-TS/skills", skills: ["effect"] }]);
    const copies = box.commands.filter((c) => c.includes("cp -R"));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toContain(".agents/skills/effect");
  });
});

describe("发现指引 / manifest", () => {
  it("skillDiscoveryInstruction 逐条点名装好的 skill 路径(没有它 codex/bub 不会去读)", () => {
    const text = skillDiscoveryInstruction(".agents/skills", ["effect", "repo-guide"]);
    expect(text).toContain(".agents/skills/effect/SKILL.md");
    expect(text).toContain(".agents/skills/repo-guide/SKILL.md");
    expect(text).toMatch(/read its `SKILL\.md`/);
  });

  it("installedSkillNames 把 local / repo 两种记录摊平成目录名", () => {
    expect(
      installedSkillNames([
        { kind: "local", name: "repo-guide", path: "skills/repo.md", sha256: "x" },
        { kind: "repo", source: "Effect-TS/skills", skills: ["effect", "effect-sql"] },
      ]),
    ).toEqual(["repo-guide", "effect", "effect-sql"]);
  });

  it("manifest 写进沙箱固定路径,读回同一份;没写过 → undefined(不生成空 artifact)", async () => {
    const box = sb();
    expect(await readAgentSetupManifest(asSandbox(box))).toBeUndefined();

    await writeAgentSetupManifest(asSandbox(box), {
      skills: [{ kind: "repo", source: "Effect-TS/skills", ref: "8f3c1a2", skills: ["effect"] }],
      mcpServers: [{ name: "browser", command: "npx", args: ["-y", "@modelcontextprotocol/server-browser"] }],
    });

    expect(box.files.has(AGENT_SETUP_MANIFEST_PATH)).toBe(true);
    const back = await readAgentSetupManifest(asSandbox(box));
    expect(back?.skills).toEqual([{ kind: "repo", source: "Effect-TS/skills", ref: "8f3c1a2", skills: ["effect"] }]);
    expect(back?.mcpServers?.[0]?.name).toBe("browser");
  });
});
