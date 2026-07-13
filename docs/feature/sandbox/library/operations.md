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

这些固定路径的文件操作会对瞬时网络错误自动做有限重试，包括 429、5xx、`fetch failed` 和连接重置。文件不存在、权限错误、取消或 Sandbox terminated 不重试。批量写重跑时仍覆盖同一组目标路径。

## 命令

```ts
const result = await t.sandbox.runCommand("pnpm", ["test"]);
const shell = await t.sandbox.runShell("pnpm lint && pnpm test");
```

两者只执行并返回结果，不自动评分。使用 `commandSucceeded()` 等 matcher 判断结果。

`runCommand` 和 `runShell` 不会自动重试。命令可能已经产生部分副作用，NiceEval 无法安全判断能否重复执行；只有调用者确认命令幂等时，才应在 eval 或 hook 里显式写重试策略。

Sandbox stop 和销毁属于 runner 生命周期，不暴露给 eval 作者。

## Agent 没有 Sandbox 时

Eval 不另写 `requires`。在 remote agent 上第一次调用 `t.sandbox.*` 时，运行器应指出具体 API 和 agent，并提示改用 sandbox agent 或移除该调用。能力错误出现在实际误用的位置，不靠一份可能漂移的声明提前猜测。
