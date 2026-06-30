# 预制 agent 沙箱模板

把 **codex / claude-code / bub** 三个 coding-agent CLI 预先烘焙进沙箱镜像/模板,
让后续 eval **跳过 setup 阶段的安装**(npm 全局装 + uv 装 bub,通常几十秒~几分钟)直接开跑。

三个后端共用同一份 [`Dockerfile`](./Dockerfile)(vercel 用等价的运行时安装脚本)。
关键约定:三个 CLI 都装到 `/usr/local/bin` —— 对所有沙箱用户(docker `node` / e2b `user` /
vercel `vercel-sandbox`)都在 `PATH` 上。agent adapter 的 `setup()` 会 `command -v` 探测,
命中就跳过安装(见 [`agents/codex.ts`](../../agents/codex.ts)、`claude-code.ts`、`bub.ts`)。

> 没有预制模板也能正常跑 —— adapter 探测不到就回退到原来的安装流程。预制只是更快。

---

## Docker

```bash
cd src/sandbox/templates
docker build -t fasteval-agents:node24 .
```

用(eval / experiment 里):

```ts
import { dockerSandbox } from "fasteval";
export default defineExperiment({
  sandbox: dockerSandbox({ image: "fasteval-agents:node24" }),
  // …
});
```

发布(让别人直接拉):`docker tag` + `docker push` 到你的 registry,文档里给出镜像名即可。

## E2B

需先 `e2b auth login`。[`e2b.toml`](./e2b.toml) 已把同目录 `Dockerfile` 配成模板 `fasteval-agents`:

```bash
cd src/sandbox/templates
e2b template build
```

用:

```ts
import { e2bSandbox } from "fasteval";
export default defineExperiment({
  sandbox: e2bSandbox({ template: "fasteval-agents" }),
  // …
});
```

模板构建在你的 e2b team 下;团队成员直接按模板名引用。

## Vercel

Vercel 没有「从 Dockerfile 构建模板」,只能对运行中的 microVM 拍快照。
[`build-vercel-snapshot.mts`](./build-vercel-snapshot.mts) 在 microVM 里跑等价安装后 snapshot:

```bash
# 需要 VERCEL_API_TOKEN + VERCEL_TEAM_ID [+ VERCEL_PROJECT_ID]
node --import tsx src/sandbox/templates/build-vercel-snapshot.mts
# → 打印 snapshotId: snap_xxx
```

用:

```ts
import { vercelSandbox } from "fasteval";
export default defineExperiment({
  sandbox: vercelSandbox({ snapshotId: "snap_xxx" }),
  // …
});
```

---

## 改了 bub 的安装规格怎么办

bub 的 `BUB_OVERRIDE` / `OTEL_PLUGIN` 在三处出现,改一处要同步另两处:

1. [`agents/bub.ts`](../../agents/bub.ts)(运行时回退安装 + 探测)
2. [`Dockerfile`](./Dockerfile)(docker / e2b 烘焙)
3. [`build-vercel-snapshot.mts`](./build-vercel-snapshot.mts)(vercel 烘焙)

改完重新构建对应后端的模板。
