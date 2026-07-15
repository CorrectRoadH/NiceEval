import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 用例登记表与测试套件的双向挂钩由测试守护(契约见
// docs/engineering/unit-tests/README.md「套件边界与仓库守护」与
// docs/engineering/unit-tests/registry.md),不引入脚本:
// 1. src/ 下每个测试文件头部声明所属清单(// cases: docs/engineering/unit-tests/<feature>/cases.md),
//    且声明指向真实存在的 cases.md——没有这条,新增测试可以绕开登记表存在,
//    「先登记后写测」的预算闸门静默失效;
// 2. 每份 cases.md 至少被一个 src 测试文件声明——没有这条,登记表可以整册与套件脱钩,
//    表上的场景行没人实现也没人发现;
// 3. 测试里的 `// bug: memory/<条目>.md` 引用指向真实存在的 memory 条目——修法台账靠
//    这条引用从测试反查现象与根因,memory 重组后的死指针比不写更糟(照着找的人会以为台账没了)。
// test/ 下的仓库守护测试没有 Feature 清单可指,不做 cases 声明(例外已写进上述文档)。
const ROOT = resolve(import.meta.dirname, "..");

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel, match);
    return match(name) ? [rel] : [];
  });
}

const isTestFile = (name: string) => name.endsWith(".test.ts") || name.endsWith(".test.tsx");

describe("用例登记表守护", () => {
  const srcTests = walk("src", isTestFile);
  const CASES_LINE = /^\/\/ cases: (docs\/engineering\/unit-tests\/[a-z-]+\/cases\.md)$/;

  it("src/ 下每个测试文件前 20 行内有且仅有一行 cases 声明,且指向真实存在的清单", () => {
    const problems: string[] = [];
    for (const file of srcTests) {
      const head = readFileSync(join(ROOT, file), "utf8").split("\n").slice(0, 20);
      const matches = head
        .map((line) => CASES_LINE.exec(line))
        .filter((m): m is RegExpExecArray => m !== null);
      if (matches.length === 0) {
        problems.push(
          `${file}: 前 20 行没有 cases 声明——在文件第一行加 // cases: docs/engineering/unit-tests/<feature>/cases.md`,
        );
        continue;
      }
      if (matches.length > 1) {
        problems.push(`${file}: 有 ${matches.length} 行 cases 声明——只保留一行`);
        continue;
      }
      const target = matches[0][1];
      if (!existsSync(join(ROOT, target))) {
        problems.push(`${file}: 声明的清单 ${target} 不存在——核对 feature 名或先建 cases.md`);
      }
    }
    expect(problems, "这些测试文件的 cases 声明缺失或失效").toEqual([]);
  });

  it("docs/engineering/unit-tests/ 下每份 cases.md 至少被一个 src 测试文件声明", () => {
    const registries = walk("docs/engineering/unit-tests", (name) => name === "cases.md");
    const declared = new Set(
      srcTests.flatMap((file) =>
        readFileSync(join(ROOT, file), "utf8")
          .split("\n")
          .slice(0, 20)
          .map((line) => CASES_LINE.exec(line)?.[1])
          .filter((t): t is string => t !== undefined),
      ),
    );
    const orphaned = registries.filter((reg) => !declared.has(reg));
    expect(
      orphaned,
      "这些登记表没有任何 src 测试文件声明——给对应 feature 的测试文件加 cases 头注,或裁决这份登记表是否该存在",
    ).toEqual([]);
  });

  it("测试里的 // bug: memory/….md 引用指向真实存在的 memory 条目", () => {
    // 没有出现算通过:这是引用格式校验,不强制每条测试都挂台账。
    const allTests = [...srcTests, ...walk("test", isTestFile)];
    const broken: string[] = [];
    for (const file of allTests) {
      const content = readFileSync(join(ROOT, file), "utf8");
      for (const m of content.matchAll(/\/\/ bug: (memory\/[\w.-]+\.md)/g)) {
        if (!existsSync(join(ROOT, m[1]))) {
          broken.push(`${file} → ${m[1]}: memory 条目不存在——核对文件名,或先补台账条目`);
        }
      }
    }
    expect(broken, "这些 bug 引用指向不存在的 memory 条目(台账重组后留下的死指针)").toEqual([]);
  });
});
