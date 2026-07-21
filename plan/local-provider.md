# PLAN：localSandbox() 本地执行 provider

## 契约（单一来源，先读再动手）

- `docs/feature/sandbox/local.md` —— 完整契约：目录解析、只观察不还原、串行独占、接口映射与不参与的面、非目标。
- 周边契约已同批更新：`docs/feature/sandbox/library.md`（workdir 表 / root 表 / 工厂列表 / provider 选择）、`docs/feature/sandbox/architecture.md`（Local provider 实现要点、留存列表）、`docs/runner.md`（`local` 推荐并发 1 + `exclusive` 独占串行声明）。
- 用户文档已更新：`docs-site/zh/tutorials/sandbox-providers.mdx` 的「本地目录」一节。

## 实现范围

1. **spec 与工厂**：`src/types.ts` 加 `LocalSandboxSpec`（可选 `dir`），工厂 `localSandbox()` 从 `niceeval/sandbox` 导出（与 `dockerSandbox` 等同址）。写 TSDoc——参考页文案单源在源码注释，之后跑 `pnpm docs:reference`。
2. **provider 实现**：新建 `src/sandbox/local.ts`。要点（见 architecture 契约）：
   - `runCommand` 按 argv `child_process` 起进程（不经 shell）；`runShell` 交给宿主 shell；`cwd` 默认 workdir，`env` 叠加宿主默认环境；路径解析复用 `src/sandbox/paths.ts`，不复制实现。
   - `{ root: true }` → 报错（信息说明本地档不提权、指向容器 provider）。
   - 文件 IO 走本地 fs。
   - `workdir` 解析：省略 `dir` 从 cwd 向上找 git 仓库根，找不到报错并给两条出路；显式 `dir` 允许非 git 仓库目录，不存在/不可写第一次抛出。
   - `stop()` 只清 runner 私有资源（分类账私有 GIT_DIR），不动工作树任何文件。
   - `otlpHost` 返回 `localhost`。
3. **分类账落位**：变更分类账的 GIT_DIR 对 local 必须放在 **workdir 外的宿主侧 runner 自有路径**（其它 provider 是沙箱内私有路径）。核对 ledger 模块（经 `docs/source-map.md` 定位）对 GIT_DIR 位置的假设，确保：不写用户 `.git`、不改 HEAD/index、归因排除清单照常生效。
4. **resolve 接线**：`src/sandbox/resolve.ts` 归一化 + `case`；provider 元数据声明 `recommendedConcurrency: 1` 与 `exclusive: true`。
5. **runner 独占闸**：runner 对声明了 `exclusive` 的 provider 加 provider 级串行闸（类似实验级闸的信号量，全局生效），`--max-concurrency` / 实验级 `maxConcurrency` 不解除；同批其它 provider 不受影响；运行反馈如实标注串行事实。核心不出现 `provider == local` 分支。
6. **组合前置报错**：`--keep-sandbox` + local 在 `create()` 之前报错（与自定义 provider 不支持留存同一形态）；local 不参与 provisioning 重试与预制环境参数（类型上就没有 image/template/snapshotId）。

## 测试（只实现已登记的行）

- `docs/engineering/testing/unit/sandbox.md` 「Local provider」分区：4 行。
- `docs/engineering/testing/unit/experiments-runner.md` 「并发」分区新增的 exclusive 行；全局上限解析行的括号已加 `local 1`。

## 验证与收尾

- `pnpm run typecheck`；`pnpm test`。
- 公开面变了：`pnpm docs:reference` 重新生成参考页区块；核对 `src/i18n/` 两份 `--help` 速查是否需要点名（无新 flag，预计不动）。
- `docs/source-map.md` 补 local provider 的契约 → 源码落点。
- 冒烟：**用一个一次性 scratch git 仓库**（不要用任何真实工作仓库）在真实 eval repo 里 `pnpm exec niceeval exp ...` 跑通：确认 agent 改动落工作树、diff 断言命中、用户 `.git` 状态逐字节不变、跑完不 reset。
