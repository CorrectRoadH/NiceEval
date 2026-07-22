# 操作 Sandbox

`t.sandbox` 提供文件 IO 和命令执行。相对路径解析到 workdir；不要 hardcode provider 的绝对路径。

## 文件

| API | 用法 |
|---|---|
| `writeFiles(files, targetDir?)` | 写文本文件清单；key 相对 `targetDir` |
| `uploadFiles(files, targetDir?)` | 写文本或二进制文件清单 |
| `uploadDirectory(localDir, targetDir?, opts?)` | 递归上传宿主目录；`opts.ignore` 排除文件 |
| `uploadFile(path, content)` | 写一个 `Buffer` |
| `readFile(path)` / `downloadFile(path)` | 分别读取文本或二进制内容 |
| `fileExists(path)` | 判断文件是否存在 |

少量内联文本用 `writeFiles`，宿主目录用 `uploadDirectory`，二进制单文件用 `uploadFile`。

`writeFiles` 的 `files` 是 `Record<路径, 文本内容>`，key 相对 `targetDir`（默认 workdir）解析；`uploadFiles` 的 `files` 是 `{ path: string; content: string | Buffer }[]`：

```ts
await t.sandbox.writeFiles({
  "src/index.ts": "export const x = 1;\n",
  "README.md": "# demo\n",
});

await t.sandbox.uploadFiles([{ path: "assets/logo.png", content: logoBuffer }]);
```

文本读取只有 `readFile(path)` 一个 API。批量读取、按扩展名过滤、拼接全文是普通代码，不设 `readSourceFiles` 这类带过滤约定的批量读取器——哪些扩展名算源码、哪些目录该剪枝因项目而异，收进 API 就成了约定式黑箱。要聚合就用命令表达，要评 agent 的改动则直接读 `t.sandbox.diff`（归因增量，起始 fixture 不会混进来，见[断言结果](asserting-results.md)）：

```ts
// 批量聚合:一条命令,过滤规则明明白白写在 eval 里
const py = await t.sandbox.runShell("find . -name '*.py' -not -path './.venv/*' -exec cat {} +");
t.check(py.stdout, includes("def solve"));

// 评 agent 改动:用归因增量,不重读整棵工作区
t.check(t.sandbox.diff.get("src/solver.py"), includes("def solve"));
```

这些固定路径的文件操作会对瞬时网络错误自动做有限重试，包括 429、5xx、`fetch failed` 和连接重置。文件不存在、权限错误、取消或 Sandbox terminated 不重试。批量写重跑时仍覆盖同一组目标路径。

## 命令

```ts
const result = await t.sandbox.runCommand("pnpm", ["test"]);
const shell = await t.sandbox.runShell("pnpm lint && pnpm test");
```

`runCommand(cmd, args?, opts?)` 把 `args` 作为独立 argv 传递、不经 shell 解释，参数来自外部输入、担心注入时优先用它；`runShell(script, opts?)` 经 bash 解释，要拼 `&&`、管道、重定向时用它。两者共用一套 `opts`：

| 字段 | 语义 |
|---|---|
| `cwd?: string` | 本命令工作目录；省略落到 workdir，相对路径按 workdir 解析，绝对路径原样使用 |
| `env?: Record<string, string>` | 追加/覆盖本命令的环境变量，与沙箱默认环境叠加；provider 固定的 `PATH` 等不保证能覆盖 |
| `root?: boolean` | 以 root 跑本命令，默认非 root；装系统依赖时用，语义见 [用户与 root](../library.md#用户与-root) |
| `stream?: boolean` | 把输出送进沙箱原生日志流（`docker logs` 实时可见）；不支持的 provider 忽略 |

返回 `CommandResult = { stdout: string; stderr: string; exitCode: number; command?: string }`。`command` 是这次执行的命令摘要（有界、脱敏，与时间树 command 节点同一份文案），由运行器在最外层公开调用处附加——`commandSucceeded()` 失败时的 evidence（「命令行本身」）就取自它；直接从 provider 拿到的裸结果可能没有这个字段。两者只执行并返回结果，非零退出码不抛错也不自动评分，判定交给 `commandSucceeded()` 等 matcher。

`runCommand` 和 `runShell` 不会自动重试。命令可能已经产生部分副作用，NiceEval 无法安全判断能否重复执行；只有调用者确认命令幂等时，才应在 eval 或 hook 里显式写重试策略。

Sandbox stop 和销毁属于 runner 生命周期，不暴露给 eval 作者。

## Agent 没有 Sandbox 时

Eval 不另写 `requires`。在 remote agent 上第一次调用 `t.sandbox.*` 时，运行器应指出具体 API 和 agent，并提示改用 sandbox agent 或移除该调用。能力错误出现在实际误用的位置，不靠一份可能漂移的声明提前猜测。
