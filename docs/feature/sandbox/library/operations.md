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
| `readSourceFiles(opts?)` | 从 workdir 批量读取源码；opts 只控制过滤规则 |

少量内联文本用 `writeFiles`，宿主目录用 `uploadDirectory`，二进制单文件用 `uploadFile`。

`writeFiles` 的 `files` 是 `Record<路径, 文本内容>`，key 相对 `targetDir`（默认 workdir）解析；`uploadFiles` 的 `files` 是 `{ path: string; content: string | Buffer }[]`：

```ts
await t.sandbox.writeFiles({
  "src/index.ts": "export const x = 1;\n",
  "README.md": "# demo\n",
});

await t.sandbox.uploadFiles([{ path: "assets/logo.png", content: logoBuffer }]);
```

`readSourceFiles` 的 `opts` 是 `{ extensions?; ignoreDirs?; ignoreFiles? }`：`extensions` 按扩展名收文件（不带点，默认 `ts/tsx/js/jsx`）、`ignoreDirs` 按目录名任意深度剪枝（默认 `.git/.next/node_modules/dist/build/coverage`）、`ignoreFiles` 按文件 basename 忽略（默认 `EVAL.ts/PROMPT.md`）。返回值是 `SourceFile[]`（`{ path, content }`，`.filter/.map` 照用）外加便利方法：`text()` 拼接全部内容（每段前带 `// path` 注释）、`code()` 同 `text()` 但先剥注释、`fileMatching(re)` / `fileMatchingAll(res)` 找内容命中的文件、`hasPath(re)` 判断是否存在命中路径：

```ts
const source = await t.sandbox.readSourceFiles({ extensions: ["py"] });
t.check(source.code(), includes("def solve"));
t.check(source.hasPath(/test_.*\.py$/), isTrue("有测试文件"));
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

返回 `CommandResult = { stdout: string; stderr: string; exitCode: number }`。两者只执行并返回结果，非零退出码不抛错也不自动评分，判定交给 `commandSucceeded()` 等 matcher。

`runCommand` 和 `runShell` 不会自动重试。命令可能已经产生部分副作用，NiceEval 无法安全判断能否重复执行；只有调用者确认命令幂等时，才应在 eval 或 hook 里显式写重试策略。

Sandbox stop 和销毁属于 runner 生命周期，不暴露给 eval 作者。

## Agent 没有 Sandbox 时

Eval 不另写 `requires`。在 remote agent 上第一次调用 `t.sandbox.*` 时，运行器应指出具体 API 和 agent，并提示改用 sandbox agent 或移除该调用。能力错误出现在实际误用的位置，不靠一份可能漂移的声明提前猜测。
