// cases: docs/engineering/unit-tests/adapters/cases.md
// 原生配置文件共享实现(native-config.ts)的单测:项目相对路径的接受/拒绝口径、原始字节
// 与 SHA-256、JSON / TOML 的语法验收与保留键判定、checkpoint key 条目随字节变化。
// 契约来源:docs/feature/adapters/architecture/coding-agent-extensions.md「类型边界」,
// 场景矩阵:docs/engineering/unit-tests/adapters/cases.md「Coding Agent 扩展安装」。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertJsonNativeConfig,
  assertTomlNativeConfig,
  loadNativeConfigFile,
  nativeConfigCheckpointItem,
  scanTomlTopLevel,
  type LoadedNativeConfig,
} from "./native-config.ts";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "niceeval-native-config-root-"));
  outside = await mkdtemp(join(tmpdir(), "niceeval-native-config-outside-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const load = (path: string) =>
  loadNativeConfigFile({ agent: "codex", field: "configFile", path, projectRoot: root });

describe("loadNativeConfigFile · 路径口径", () => {
  it("普通相对路径与 ./ 前缀都合法,manifest 路径规范化(./ 剥掉)", async () => {
    await mkdir(join(root, "configs"), { recursive: true });
    await writeFile(join(root, "configs/no-web.toml"), 'web_search = "disabled"\n');

    const plain = await load("configs/no-web.toml");
    const dotted = await load("./configs/no-web.toml");
    expect(plain.path).toBe("configs/no-web.toml");
    expect(dotted.path).toBe("configs/no-web.toml");
    expect(plain.sha256).toBe(dotted.sha256);
  });

  it("原始字节逐字节读回,SHA-256 是字节哈希;改一个字节 → 哈希与 checkpoint 条目都变", async () => {
    const body = '#:schema https://example.com/schema.json\nweb_search = "disabled"\n';
    await writeFile(join(root, "a.toml"), body);
    const a = await load("a.toml");
    expect(a.bytes.toString("utf8")).toBe(body);
    expect(a.sha256).toBe(createHash("sha256").update(body).digest("hex"));

    await writeFile(join(root, "b.toml"), body.replace("disabled", "disablee"));
    const b = await load("b.toml");
    expect(b.sha256).not.toBe(a.sha256);
    expect(nativeConfigCheckpointItem("codex", b)).not.toBe(nativeConfigCheckpointItem("codex", a));
    expect(nativeConfigCheckpointItem("codex", a)).toContain(a.sha256);
  });

  it("包含 `..` 的路径、绝对路径与 `~` 路径都拒绝", async () => {
    await expect(load("../a.toml")).rejects.toThrow(/相对路径|relative/);
    await expect(load("configs/../../a.toml")).rejects.toThrow(/相对路径|relative/);
    await expect(load(join(root, "a.toml"))).rejects.toThrow(/相对路径|relative/);
    await expect(load("~/a.toml")).rejects.toThrow(/相对路径|relative/);
    await expect(load("")).rejects.toThrow(/相对路径|relative/);
  });

  it("路径不存在时报错点名原路径与解析后的绝对路径", async () => {
    await expect(load("configs/nope.toml")).rejects.toThrow(/configs\/nope\.toml/);
  });

  it("符号链接解析后逃出项目根 → 拒绝", async () => {
    await writeFile(join(outside, "escape.toml"), 'web_search = "disabled"\n');
    await symlink(join(outside, "escape.toml"), join(root, "escape.toml"));
    await expect(load("escape.toml")).rejects.toThrow(/项目根之外|outside the project root/);
  });

  it("指向目录 → 拒绝(不是普通文件)", async () => {
    await mkdir(join(root, "configs"), { recursive: true });
    await expect(load("configs")).rejects.toThrow(/普通文件|regular file/);
  });
});

const cfgOf = (text: string): LoadedNativeConfig => ({
  path: "configs/x",
  bytes: Buffer.from(text, "utf8"),
  sha256: createHash("sha256").update(text).digest("hex"),
});

describe("assertJsonNativeConfig(claude-code settings.json)", () => {
  const opts = { agent: "claude-code", field: "settingsFile", reservedKeys: ["model", "env"] };

  it("合法 JSON 对象 + 无保留键 → 通过($schema 等标记不受影响)", () => {
    const cfg = cfgOf('{ "$schema": "https://x", "permissions": { "deny": ["WebSearch"] } }');
    expect(() => assertJsonNativeConfig(cfg, opts)).not.toThrow();
  });

  it("语法错误 → 报错点名文件与 JSON", () => {
    expect(() => assertJsonNativeConfig(cfgOf("{ nope"), opts)).toThrow(/JSON/);
  });

  it("顶层不是对象(数组)→ 语法验收失败", () => {
    expect(() => assertJsonNativeConfig(cfgOf("[1, 2]"), opts)).toThrow(/JSON/);
  });

  it("顶层保留键(model / env)→ 报错点名冲突键", () => {
    const cfg = cfgOf('{ "model": "opus", "env": { "A": "1" }, "permissions": {} }');
    expect(() => assertJsonNativeConfig(cfg, opts)).toThrow(/model, env/);
  });

  it("保留键只看顶层:嵌套对象里的同名键不算", () => {
    const cfg = cfgOf('{ "permissions": { "model": "x", "env": {} } }');
    expect(() => assertJsonNativeConfig(cfg, opts)).not.toThrow();
  });
});

describe("assertTomlNativeConfig(codex config.toml)", () => {
  const opts = {
    agent: "codex",
    field: "configFile",
    reservedKeys: ["model", "model_provider", "model_providers", "model_reasoning_effort", "mcp_servers", "otel"],
  };

  it("合法 TOML + 无保留键 → 通过(schema 注释、普通表都保留判定之外)", () => {
    const cfg = cfgOf(
      '#:schema https://developers.openai.com/codex/config-schema.json\nweb_search = "disabled"\n\n[sandbox_workspace_write]\nnetwork_access = false\n',
    );
    expect(() => assertTomlNativeConfig(cfg, opts)).not.toThrow();
  });

  it("顶层保留键赋值(model = …)→ 报错点名冲突键", () => {
    expect(() => assertTomlNativeConfig(cfgOf('model = "gpt-5"\n'), opts)).toThrow(/model/);
  });

  it("保留表头([mcp_servers.x] / [otel])→ 报错点名首段", () => {
    expect(() => assertTomlNativeConfig(cfgOf('[mcp_servers.browser]\ncommand = "npx"\n'), opts)).toThrow(
      /mcp_servers/,
    );
    expect(() => assertTomlNativeConfig(cfgOf("[otel]\nenvironment = 'x'\n"), opts)).toThrow(/otel/);
  });

  it("顶层点分键(otel.environment = …)按首段判保留", () => {
    expect(() => assertTomlNativeConfig(cfgOf('otel.environment = "x"\n'), opts)).toThrow(/otel/);
  });

  it("非保留表**里面**的同名键不算顶层保留键([profiles.x] 下的 model 属于 profiles)", () => {
    const cfg = cfgOf('[profiles.fast]\nmodel = "gpt-5"\n');
    expect(() => assertTomlNativeConfig(cfg, opts)).not.toThrow();
  });

  it("字符串与多行数组里的「model =」不误判", () => {
    const cfg = cfgOf('note = "model = fake"\nallow = [\n  "model",\n]\n');
    expect(() => assertTomlNativeConfig(cfg, opts)).not.toThrow();
  });

  it("语法错误(既不是键赋值也不是表头的行)→ 报错", () => {
    expect(() => assertTomlNativeConfig(cfgOf("just some words\n"), opts)).toThrow(/TOML/);
  });

  it("未闭合的多行字符串 → 报错", () => {
    expect(() => assertTomlNativeConfig(cfgOf('a = """\nnever closed\n'), opts)).toThrow(/TOML/);
  });
});

describe("scanTomlTopLevel", () => {
  it("多行字符串里的表头形状不进入键集合", () => {
    const scan = scanTomlTopLevel('a = """\n[mcp_servers.fake]\n"""\nb = 1\n');
    expect(scan.error).toBeUndefined();
    expect([...scan.rootKeys].sort()).toEqual(["a", "b"]);
  });

  it("带引号的表头首段剥引号", () => {
    const scan = scanTomlTopLevel('["otel".sub]\nx = 1\n');
    expect(scan.rootKeys.has("otel")).toBe(true);
  });
});
