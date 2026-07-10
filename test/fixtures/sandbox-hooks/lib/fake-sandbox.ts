// 内存假 Sandbox:实现 niceeval 的 Sandbox 接口,但不起任何真容器 / microVM。
// 只为跑通 runner 的固定段(git 基线 / 采 diff 等对空操作容忍)——测试真正关心的是
// sandbox.setup / sandbox.teardown 钩子与 agent 生命周期方法的调用顺序,不是沙箱本身。
import type { CommandResult, Sandbox, SandboxFile, SourceFile, SourceFiles } from "niceeval/sandbox";

function emptySourceFiles(): SourceFiles {
  const arr: SourceFile[] = [];
  return Object.assign(arr, {
    text: () => "",
    code: () => "",
    fileMatching: () => undefined,
    fileMatchingAll: () => undefined,
    hasPath: () => false,
  });
}

const OK: CommandResult = { stdout: "", stderr: "", exitCode: 0 };

export function createFakeSandbox(): Sandbox {
  const files = new Map<string, string>();
  return {
    workdir: "/fake",
    sandboxId: `fake-${Math.random().toString(36).slice(2)}`,
    otlpHost: null,
    async runCommand() {
      return OK;
    },
    async runShell() {
      return OK;
    },
    async readFile(path: string) {
      const v = files.get(path);
      if (v === undefined) throw new Error(`fake sandbox: no file ${path}`);
      return v;
    },
    async fileExists() {
      return false;
    },
    async readSourceFiles() {
      return emptySourceFiles();
    },
    async writeFiles(f: Record<string, string>) {
      for (const [k, v] of Object.entries(f)) files.set(k, v);
    },
    async uploadFiles(fs: SandboxFile[]) {
      for (const file of fs) files.set(file.path, typeof file.content === "string" ? file.content : file.content.toString("utf-8"));
    },
    async uploadDirectory() {},
    async stop() {},
    async downloadFile() {
      return Buffer.alloc(0);
    },
    async uploadFile() {},
  };
}
