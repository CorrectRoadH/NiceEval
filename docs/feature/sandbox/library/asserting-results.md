# 断言 Sandbox 结果

Sandbox 在 Agent 执行前建立 git 基线，作用域断言和结果视图读取最终工作区变化。

```ts
t.sandbox.fileChanged("src/index.ts");
t.sandbox.fileDeleted("src/legacy.ts");
t.sandbox.notInDiff(/console\.log/);
t.sandbox.noFailedShellCommands();

t.check(t.sandbox.diff.get("src/index.ts"), includes("await"));
t.check(t.sandbox.file("package.json"), matches(PackageSchema));
```

| API | 类型 | 用法 |
|---|---|---|
| `fileChanged(path)` | 延迟断言 | 文件出现在最终 diff |
| `fileDeleted(path)` | 延迟断言 | 文件在最终 diff 中被删除 |
| `notInDiff(re)` | 延迟断言 | 最终 diff 不含模式 |
| `noFailedShellCommands()` | 延迟断言 | Agent 发起的 shell 工具没有失败退出 |
| `diff.get(path)` | 结果材料 | 某个生成/修改文件的最终内容；文件不在 diff 里返回 `undefined` |
| `diff.isEmpty()` | 结果材料 | 判断最终 diff 是否为空 |
| `diff.matches(re)` | 结果材料 | 判断最终 diff 是否命中正则 |
| `file(path)` | 延迟材料 | finalize 时读取 Sandbox 文件，交给 matcher |

- `noFailedShellCommands` 只看 Agent 自己发起的 shell 工具，不看 eval 的验证命令。

值 matcher、Severity 与 Verdict 见 [Scoring](../../scoring/README.md)。
