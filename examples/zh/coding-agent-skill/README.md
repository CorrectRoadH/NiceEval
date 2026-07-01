# 例子：用 niceeval 量化 Claude Code Skill / Plugin 的实际收益

这个例子展示两件事：
1. **如何编写本地 Skill** 并验证它让 agent 输出更好的代码
2. **如何把第三方 Plugin 的 benchmark 迁移到 niceeval**

两组实验独立运行，使用不同的 skill、eval 集和对照组。

---

## 目录结构

```
coding-agent-skill/
├── niceeval.config.ts              # 全局配置（sandbox、judge）
├── skills/
│   ├── zod.md                      # 自编写的 Zod 校验 skill
│   └── ponytail.md                 # 第三方 Ponytail plugin（MIT）
├── evals/
│   │── api-validation.eval.ts      # Zod：校验 API 请求体
│   │── config-schema.eval.ts       # Zod：用 schema 解析环境变量
│   │── ponytail-safe-path.eval.ts  # Ponytail：路径穿越（隐式安全需求）
│   │── ponytail-csv-sum.eval.ts    # Ponytail：CSV 求和（简洁 vs 重型依赖）
│   └── ponytail-reuse.eval.ts      # Ponytail：复用现有工具 vs 重写
└── experiments/
    ├── with-skill.ts               # Zod skill 注入 → 跑 zod evals
    ├── baseline.ts                 # 无 skill 对照组 → 跑 zod evals
    ├── ponytail.ts                 # Ponytail 注入 → 跑 ponytail evals
    └── ponytail-baseline.ts        # 无 skill 对照组 → 跑 ponytail evals
```

---

## 实验一：自编写 Skill（Zod 校验）

**skill 文件**：`skills/zod.md`

这是一个自编写的 skill，描述了在 TypeScript 项目里用 Zod 做运行时校验的最佳实践：
何时用 `.safeParse()` vs `.parse()`、如何定义 schema、如何用 `z.infer<>` 派生类型。

**注入方式**：`experiments/with-skill.ts` 在沙箱 setup 阶段把 `skills/zod.md` 写入
工作区的 `CLAUDE.md`，claude CLI 启动时自动读取。

**A/B 实验**：

```sh
# 跑两组（有 skill vs 无 skill），对比通过率
npx niceeval exp compare

# 看结果
npx niceeval view
```

**期望结论**：有 skill 的组能正确使用 `z.object().safeParse()`，避免裸 `JSON.parse`
和 `as unknown as T` 类型断言；无 skill 的组通常退回到手写类型守卫或 try/catch。

---

## 实验二：第三方 Plugin（Ponytail benchmark 迁移）

**plugin 文件**：`skills/ponytail.md`（来源：[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md)，MIT 协议）

Ponytail 是一个"懒惰高级开发者"决策梯 skill：先查 YAGNI、再查现有代码、再查标准库、
再考虑现有依赖，最后才写最少的原始代码。

**benchmark 迁移逻辑**：

ponytail 原始 benchmark 有两个套件：
- `promptfoo` 单轮测试（5 个编码 prompt + 3 个行为探针）
- `agentic` 真实 Claude Code 会话（安全层 + 质量层 + 开放任务，共 40+ 个）

我们从 `agentic` 套件中迁移了最有代表性的三个任务到 niceeval 格式：

| eval 文件 | 对应 agentic 任务 | 测什么 |
|-----------|-------------------|--------|
| `ponytail-safe-path.eval.ts` | `safe-path` | 隐式路径穿越防御 |
| `ponytail-reuse.eval.ts` | `reuse-slug` | 复用现有工具 vs 重写 |
| `ponytail-csv-sum.eval.ts` | `csv-sum` | 用标准库 vs 引入 pandas |

**迁移关键点**（原 benchmark → niceeval）：

| 原 benchmark | niceeval 等价 |
|-------------|--------------|
| `seed` 字段写文件 | `t.sandbox.writeFiles({})` |
| `tasks.py` 里的 prompt | `t.send("...")` |
| `correctness.js` 运行子进程断言 | `t.sandbox.runCommand("python3", [...])` |
| `judge.py` LLM judge | `t.judge.autoevals.closedQA("...", { on }).atLeast(n)` |
| promptfoo `arms`（baseline/ponytail） | niceeval `experiments/` |
| `--plugin-dir` 注入 skill | experiment-local agent wrapper 在 `setup` 写 `CLAUDE.md` |

**运行对比**：

```sh
# 跑 ponytail 实验组 + 对照组
npx niceeval exp ponytail ponytail-baseline

# 看报告
npx niceeval view
```

---

## 快速开始

### 1. 安装依赖

```sh
npm install -D niceeval
```

### 2. 配置环境变量

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. 确保 Docker 可用

```sh
docker info
```

### 4. 运行实验

```sh
# Zod skill A/B 对比
npx niceeval exp compare

# Ponytail benchmark
npx niceeval exp ponytail ponytail-baseline

# 查看所有结果
npx niceeval view
```

---

## 扩展：如何迁移更多 ponytail benchmark 任务

ponytail 的 `agentic` 套件还有 SQL 注入防御、金额格式化复用、根因分析等任务，
迁移模式都相同：

```typescript
export default defineEval({
  description: "...",
  async test(t) {
    // 1. 写入种子文件
    await t.sandbox.writeFiles({ "task.py": "..." });

    // 2. 发送任务 prompt（不提示安全/最佳实践，模拟真实工单）
    await t.send("实现 get_user(conn, username) 函数...").then(r => r.expectOk());

    // 3. 功能测试：用对抗性输入跑子进程
    const r = await t.sandbox.runCommand("python3", ["-c", "..."]);
    t.check(r.stdout.trim(), includes(/ok/));

    // 4. LLM judge 打分（简洁度 + 正确性）
    t.judge.autoevals.closedQA("...", { on: await t.sandbox.readFile("task.py") }).atLeast(0.8);
  },
});
```
