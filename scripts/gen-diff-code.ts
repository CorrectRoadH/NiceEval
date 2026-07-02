// 生成「接入 niceeval 前后」的代码对比 MDX，供 docs-site 阅读。
//
// 用法：pnpm run gen:diff-code
//
// 每个对比是 PAIRS 里的一项（source = 接入前目录，target = 接入后目录），
// 未来有新的 before/after 示例时往 PAIRS 里加一项即可。
//
// 渲染成 GitHub PR 式的 diff 视图（双行号列、文件头栏、红绿行、hunk 行）。
// Mintlify 的代码块表达不了行号和文件头，所以这里在生成时用 Shiki 做
// GitHub 配色的语法高亮，直接产出带 className 的 HTML 表格，样式在
// docs-site/github-diff.css（同样由本脚本生成，Mintlify 自动加载仓库里的 .css）。
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { codeToTokens, type ThemedToken } from "shiki";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_OUT = "docs-site/github-diff.css";
const JS_OUT = "docs-site/github-diff.js";

/** 折叠参数：变更行上下各留几行上下文；藏起来的行少于阈值就不折 */
const FOLD_CONTEXT = 3;
const FOLD_MIN_HIDDEN = 4;

interface DiffPair {
  /** 接入前的目录，相对仓库根 */
  source: string;
  /** 接入后的目录，相对仓库根 */
  target: string;
  /** 输出的 MDX 路径，相对仓库根 */
  out: string;
  frontmatter: { title: string; sidebarTitle?: string; description: string };
  /** 正文开头的说明（frontmatter 之后、文件清单之前） */
  intro: string;
  /** 阅读顺序：按前缀匹配排序，越靠前越先读；不匹配的排最后按字母序 */
  order: string[];
  /** 页面分节：文件按前缀归入第一个匹配的节；不匹配的进最后一节 */
  sections: Array<{ title: string; files: string[] }>;
  /** 这个对比额外排除的文件（精确路径或目录前缀），如 README、env 模板等与接入无关的 */
  exclude?: string[];
}

const PAIRS: DiffPair[] = [
  {
    source: "examples/zh/origin/ai-sdk-v7",
    target: "examples/zh/eval/ai-sdk-v7",
    out: "docs-site/zh/example/ai-sdk-v7-before-after.mdx",
    frontmatter: {
      title: "ai-sdk 如何接入 NiceEval",
      sidebarTitle: "ai-sdk 如何接入 NiceEval",
      description:
        "同一个 AI SDK v7 助手，接入 NiceEval 前后的完整代码 diff：加了哪些文件，原有代码动了多少。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[`examples/zh/origin/ai-sdk-v7/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/ai-sdk-v7) —— 一个普通的 AI SDK v7 聊天应用（HTTP 服务器 + React 聊天 UI），还没接任何 eval。",
      "- **after**：[`examples/zh/eval/ai-sdk-v7/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/eval/ai-sdk-v7) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "先看文件树了解改动范围，再分两部分读 diff：应用侧改了什么",
      "（`ai-sdk-runtime.ts` 把 `streamChat` 里的 streamText 调用拆成独立的 `chat()`",
      "——唯一的模型调用点，只是多收一个可选 opts 透传取消信号和 telemetry，UI 和",
      "eval 跑的是同一次调用；`assistant.ts` 多一个 `send_email` 工具用来演示",
      "tool approval + HITL，两者都不 import 任何 niceeval 的东西），以及 eval",
      "侧整体新增了什么（config、evals、experiments，`aiSdkAgent` 接线也在这里）。",
    ].join("\n"),
    order: [
      "src/ai-sdk-runtime.ts",
      "src/assistant.ts",
      "src/",
      "package.json",
      "tsconfig.json",
      "pnpm-workspace.yaml",
      "niceeval.config.ts",
      "evals/",
      "experiments/",
    ],
    sections: [
      {
        title: "应用侧的变更",
        files: ["src/", "package.json", "tsconfig.json", "pnpm-workspace.yaml"],
      },
      {
        title: "新增的 evals 与 experiments",
        files: ["niceeval.config.ts", "evals/", "experiments/"],
      },
    ],
    exclude: ["README.md", ".env.example"],
  },
  {
    source: "examples/zh/origin/claude-agent-sdk",
    target: "examples/zh/eval/claude-agent-sdk",
    out: "docs-site/zh/example/claude-agent-sdk-before-after.mdx",
    frontmatter: {
      title: "Claude Agent SDK 如何非侵入式接入 NiceEval",
      sidebarTitle: "Claude Agent SDK 如何接入",
      description:
        "一个 Claude Agent SDK 助手后端，接入 NiceEval 前后的完整代码 diff：应用侧一行没改，全部新增在 eval 侧。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[`examples/zh/origin/claude-agent-sdk/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/claude-agent-sdk) —— 一个独立的 `@anthropic-ai/claude-agent-sdk` HTTP 服务（`server.ts`/`agent.ts`/`tools.ts`），还没接任何 eval。",
      "- **after**：[`examples/zh/eval/claude-agent-sdk/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/eval/claude-agent-sdk) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "这份 diff 的看点是：应用侧的 `server.ts`/`agent.ts`/`tools.ts` **逐字节未变**——`agents/claude-agent-sdk.ts`",
      "把应用当黑盒，按需拉起它的 `server.ts` 子进程、轮询 `/healthz`，再用一次 `fetch`",
      "调 `POST /api/chat`，把 `{reply, toolCalls}` 映射成标准事件流。package.json /",
      "pnpm-workspace.yaml 只加了 niceeval 这一个 devDependency，没有别的改动。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧的变更(只有依赖声明)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    exclude: ["README.md", ".env.example"],
  },
  {
    source: "examples/zh/origin/codex-sdk",
    target: "examples/zh/eval/codex-sdk",
    out: "docs-site/zh/example/codex-sdk-before-after.mdx",
    frontmatter: {
      title: "Codex SDK 如何非侵入式接入 NiceEval",
      sidebarTitle: "Codex SDK 如何接入",
      description:
        "一个 Codex SDK（目录里的编码 agent）后端，接入 NiceEval 前后的完整代码 diff：应用侧一行没改。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[`examples/zh/origin/codex-sdk/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/codex-sdk) —— 一个独立的 `@openai/codex-sdk` HTTP 服务，还没接任何 eval。",
      "- **after**：[`examples/zh/eval/codex-sdk/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/eval/codex-sdk) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "`server.ts`/`agent.ts` 逐字节未变。`agents/codex-sdk.ts` 拉起同一个子进程、调",
      "`POST /api/chat`，把 Codex 自己的动作分类（`command_execution` / `file_change` /",
      "`mcp_tool_call` / ...）映射成标准事件流；`error` 类型映射成 `StreamEvent` 的",
      "`error`，不算进失败的工具调用。eval 测的是真实的“在目录里写文件、跑命令”，不是",
      "硬凑的天气/计算器工具。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧的变更(只有依赖声明)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    exclude: ["README.md", ".env.example"],
  },
  {
    source: "examples/zh/origin/custom-genai",
    target: "examples/zh/eval/custom-genai",
    out: "docs-site/zh/example/custom-genai-before-after.mdx",
    frontmatter: {
      title: "手写 GenAI 埋点应用如何非侵入式接入 NiceEval",
      sidebarTitle: "手写 OTel 埋点如何接入",
      description:
        "一个不用 vendor SDK、手写 OTel GenAI 语义约定埋点的聊天服务，接入 NiceEval 前后的完整代码 diff。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[`examples/zh/origin/custom-genai/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/custom-genai) —— 手写工具调用循环 + 手写 `@opentelemetry/api` GenAI 语义约定埋点，还没接任何 eval。",
      "- **after**：[`examples/zh/eval/custom-genai/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/eval/custom-genai) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "`server.ts`/`agent.ts`/`tools.ts`/`tracing.ts` 逐字节未变——这个应用自己的 OTel",
      "span（`traceChatCall`/`traceToolCall`）继续按原样发往它自己配置的后端，和",
      "NiceEval 完全无关。`agents/custom-genai.ts` 只是把 `POST /api/chat` 的",
      "`{reply, toolCalls}` 响应体翻译成标准事件流。这个应用是单轮的（`sessionId` 没有",
      "真的接进对话状态），所以 adapter 只声明 `toolObservability`，不声明",
      "`conversation`——多声明会让负断言看起来可信但其实没有反映真实能力。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧的变更(只有依赖声明)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    exclude: ["README.md", ".env.example"],
  },
  {
    source: "examples/zh/origin/langgraph",
    target: "examples/zh/eval/langgraph",
    out: "docs-site/zh/example/langgraph-before-after.mdx",
    frontmatter: {
      title: "LangGraph ReAct agent 如何非侵入式接入 NiceEval",
      sidebarTitle: "LangGraph 如何接入",
      description:
        "一个 LangGraph createReactAgent + LangSmith OTel 导出的应用，接入 NiceEval 前后的完整代码 diff。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[`examples/zh/origin/langgraph/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/langgraph) —— 一个 `@langchain/langgraph` ReAct agent 服务，还没接任何 eval。",
      "- **after**：[`examples/zh/eval/langgraph/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/eval/langgraph) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "`server.ts`/`observability.ts`/`agent/` 逐字节未变。`agents/langgraph.ts` 需要",
      "自己生成 `sessionId`（`ctx.session.id ??= crypto.randomUUID()`）——应用把没带",
      "`sessionId` 的请求都归到同一个 `\"default\"` LangGraph `thread_id`，不生成就会让",
      "所有并行 eval 撞进同一条对话历史。`evals/session-isolation.eval.ts` 顺带验证了",
      "这一点：`MemorySaver` 按整条 checkpointer 历史吐 `toolCalls`，同一 session 内的",
      "第 N 轮能看到第 1..N 轮的全部调用，只有新开的 session 才是干净的。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧的变更(只有依赖声明)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    exclude: ["README.md", ".env.example"],
  },
  {
    source: "examples/zh/origin/openllmetry",
    target: "examples/zh/eval/openllmetry",
    out: "docs-site/zh/example/openllmetry-before-after.mdx",
    frontmatter: {
      title: "OpenLLMetry 埋点应用如何非侵入式接入 NiceEval",
      sidebarTitle: "OpenLLMetry 如何接入",
      description:
        "一个用 `@traceloop/node-server-sdk` 自动埋点的工具调用聊天服务，接入 NiceEval 前后的完整代码 diff。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[`examples/zh/origin/openllmetry/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/openllmetry) —— 手写工具调用循环 + OpenLLMetry 自动埋点，还没接任何 eval。",
      "- **after**：[`examples/zh/eval/openllmetry/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/eval/openllmetry) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "`server.ts`/`agent.ts`/`tools.ts`/`instrumentation.ts` 逐字节未变。和 langgraph",
      "示例一样，这个应用的 `chat(message, sessionId?)` 在没收到 `sessionId` 时会退回",
      "共享的 `\"default\"` 历史 —— `agents/openllmetry.ts` 同样要在 `send` 里自己生成",
      "一个 `sessionId`，否则并行跑的 eval 会互相看到对方的对话历史。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧的变更(只有依赖声明)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    exclude: ["README.md", ".env.example"],
  },
  {
    source: "examples/zh/origin/openinference",
    target: "examples/zh/eval/openinference",
    out: "docs-site/zh/example/openinference-before-after.mdx",
    frontmatter: {
      title: "OpenInference / Phoenix 埋点应用如何非侵入式接入 NiceEval",
      sidebarTitle: "OpenInference 如何接入",
      description:
        "一个 Python / FastAPI + LangChain agent，用 OpenInference/Phoenix 埋点，接入 NiceEval 前后的完整代码 diff。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[`examples/zh/origin/openinference/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/openinference) —— 一个 Python FastAPI + LangChain agent，`openinference-instrumentation-langchain` + `arize-phoenix-otel` 埋点，还没接任何 eval。",
      "- **after**：[`examples/zh/eval/openinference/`](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/eval/openinference) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "这一对最特殊：被测应用是 **Python**，NiceEval 是 TypeScript 工具，两者只通过",
      "HTTP 打交道——`observability.py`/`tools.py`/`agent.py`/`server.py` 一行没改，",
      "新增的全部是 `eval/` 目录里从零搭的 Node/TS 脚手架（`package.json`、",
      "`tsconfig.json`、`pnpm-workspace.yaml`）。`agents/openinference.ts` 拉起的子",
      "进程是 `.venv/bin/python server.py` 而不是 `node`/`tsx`，其余（健康检查轮询、",
      "`POST /api/chat` 映射）和其它示例同构。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧(零改动,只是新加了 TS 脚手架)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    exclude: ["README.md", ".env.example", "requirements.txt", "static/", "docker-compose.yml"],
  },
];

// 与学习无关的目录/文件，不进 diff
const EXCLUDES = [/(^|\/)node_modules(\/|$)/, /(^|\/)\.niceeval(\/|$)/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)\.env$/, /(^|\/)\.DS_Store$/];

type Status = "新增" | "修改" | "删除";

function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (EXCLUDES.some((re) => re.test(rel))) continue;
    if (entry.isDirectory()) files.push(...listFiles(dir, rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

function rank(file: string, order: string[]): number {
  const i = order.findIndex((prefix) => file === prefix || file.startsWith(prefix));
  return i === -1 ? order.length : i;
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

function shikiLang(file: string): string {
  if (/\.tsx?$/.test(file)) return "typescript";
  if (/\.json$/.test(file)) return "json";
  if (/\.ya?ml$/.test(file)) return "yaml";
  if (/\.mdx?$/.test(file)) return "markdown";
  if (/\.m?js$/.test(file)) return "javascript";
  if (/\.env(\.|$)/.test(basename(file))) return "ini";
  return "txt";
}

// ---- diff（纯实现，避免依赖外部 diff 命令或库）----

type Op = { t: " " | "-" | "+"; line: string };

function diffOps(a: string[], b: string[]): Op[] {
  // LCS 动态规划；示例文件都在几百行以内，O(n·m) 足够
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: " ", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: "-", line: a[i++] });
    else ops.push({ t: "+", line: b[j++] });
  }
  while (i < n) ops.push({ t: "-", line: a[i++] });
  while (j < m) ops.push({ t: "+", line: b[j++] });
  return ops;
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** 完整文件的 diff op 序列：像 GitHub PR 展开全部行那样展示，不截 hunk 上下文 */
function fullFileOps(beforeText: string, afterText: string): Op[] {
  return diffOps(splitLines(beforeText), splitLines(afterText));
}

// ---- Shiki 高亮：token → 调色板 class，颜色集中到生成的 CSS 里 ----

/** `${light}|${dark}` → class 名，跨所有文件共享，调色板很小（十几个） */
const palette = new Map<string, string>();

/** 折叠区的全局唯一 id 计数 */
let foldSeq = 0;

function tokenClass(token: ThemedToken): string | undefined {
  const style = token.htmlStyle as Record<string, string> | undefined;
  const light = style?.color;
  const dark = style?.["--shiki-dark"];
  if (!light && !dark) return undefined;
  const key = `${light ?? ""}|${dark ?? ""}`;
  let cls = palette.get(key);
  if (!cls) {
    cls = `gdt${palette.size}`;
    palette.set(key, cls);
  }
  return cls;
}

/** 整个文件一次性 tokenize（保住多行结构：模板字符串、块注释），返回逐行 JSX */
async function highlightLines(text: string, lang: string): Promise<string[]> {
  const { tokens } = await codeToTokens(text.replace(/\n$/, ""), {
    lang: lang as never,
    themes: { light: "github-light", dark: "github-dark" },
  });
  return tokens.map((line) => {
    if (line.length === 0) return jsxText(" ");
    return line
      .map((token) => {
        if (token.content === "") return "";
        const cls = tokenClass(token);
        return cls ? `<span className="${cls}">${jsxText(token.content)}</span>` : jsxText(token.content);
      })
      .join("");
  });
}

/** MDX 里最稳的转义方式：包成 JS 字符串字面量表达式 */
function jsxText(text: string): string {
  return `{${JSON.stringify(text)}}`;
}

// ---- 文件树 ----

interface TreeNode {
  children: Map<string, TreeNode>;
  status?: Status;
}

function renderTree(entries: Array<{ file: string; status: Status }>, rootLabel: string, order: string[]): string {
  const root: TreeNode = { children: new Map() };
  for (const { file, status } of entries) {
    let node = root;
    for (const part of file.split("/")) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
    node.status = status;
  }

  // 节点排序：按其下所有文件的最小阅读顺序，其次按名字
  const nodeRank = (node: TreeNode, path: string): number => {
    if (node.children.size === 0) return rank(path, order);
    return Math.min(...[...node.children].map(([name, child]) => nodeRank(child, `${path}/${name}`.replace(/^\//, ""))));
  };

  const rows: Array<[string, string]> = [[`${rootLabel}/`, ""]];
  const walk = (node: TreeNode, path: string, indent: string) => {
    const children = [...node.children].sort(([na, a], [nb, b]) => {
      const pa = path ? `${path}/${na}` : na;
      const pb = path ? `${path}/${nb}` : nb;
      return nodeRank(a, pa) - nodeRank(b, pb) || na.localeCompare(nb);
    });
    children.forEach(([name, child], i) => {
      const isLast = i === children.length - 1;
      const childPath = path ? `${path}/${name}` : name;
      const label = child.children.size > 0 ? `${name}/` : name;
      rows.push([`${indent}${isLast ? "└── " : "├── "}${label}`, child.status ?? ""]);
      walk(child, childPath, indent + (isLast ? "    " : "│   "));
    });
  };
  walk(root, "", "");

  const width = Math.max(...rows.map(([tree]) => tree.length));
  return rows.map(([tree, status]) => (status ? `${tree.padEnd(width + 3)}${status}` : tree)).join("\n");
}

// ---- GitHub PR 式 diff 表格 ----

async function renderFileDiff(pair: DiffPair, file: string, status: Status): Promise<string[]> {
  const before = status === "新增" ? Buffer.alloc(0) : readFileSync(join(ROOT, pair.source, file));
  const after = status === "删除" ? Buffer.alloc(0) : readFileSync(join(ROOT, pair.target, file));

  // Mintlify 会剥掉 <details>/<summary>，只能用 div（不做折叠）
  const head = (extra: string) =>
    `<div className="gd-head"><span className="gd-name">${jsxText(file)}</span>${extra}</div>`;

  if (isBinary(before) || isBinary(after)) {
    const size = status === "删除" ? before.length : after.length;
    return [
      `<div className="gd-file">`,
      head(`<span className="gd-stats">${jsxText("BIN")}</span>`),
      `<div className="gd-note">${jsxText(`二进制文件，${size} bytes，略`)}</div>`,
      `</div>`,
    ];
  }

  const lang = shikiLang(file);
  const beforeLines = await highlightLines(before.toString("utf8"), lang);
  const afterLines = await highlightLines(after.toString("utf8"), lang);
  // 展示机制：完整文件全部行（像 GitHub PR 展开全部），变更行红绿标注，
  // 不截 hunk 上下文，也就没有 @@ 行
  const ops = fullFileOps(before.toString("utf8"), after.toString("utf8"));

  const adds = ops.filter((o) => o.t === "+").length;
  const dels = ops.filter((o) => o.t === "-").length;
  const stats =
    `<span className="gd-stats">` +
    (adds ? `<span className="gd-plus">${jsxText(`+${adds}`)}</span>` : "") +
    (dels ? `<span className="gd-minus">${jsxText(`−${dels}`)}</span>` : "") +
    `</span>`;

  // 折叠：离最近变更行超过 FOLD_CONTEXT 的上下文行默认隐藏，像 GitHub 一样
  // 用蓝色展开条占位（点击展开由 github-diff.js 处理）；藏的行太少就不折
  const dist = new Array<number>(ops.length).fill(Number.POSITIVE_INFINITY);
  {
    let last = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < ops.length; k++) {
      if (ops[k].t !== " ") last = k;
      dist[k] = k - last;
    }
    let next = Number.POSITIVE_INFINITY;
    for (let k = ops.length - 1; k >= 0; k--) {
      if (ops[k].t !== " ") next = k;
      dist[k] = Math.min(dist[k], next - k);
    }
  }
  const hide = dist.map((d) => d > FOLD_CONTEXT);
  for (let k = 0; k < ops.length; ) {
    if (!hide[k]) {
      k++;
      continue;
    }
    let j = k;
    while (j < ops.length && hide[j]) j++;
    if (j - k < FOLD_MIN_HIDDEN) for (let x = k; x < j; x++) hide[x] = false;
    k = j;
  }

  const rows: string[] = [];
  let aLine = 1;
  let bLine = 1;
  const pushRow = (op: Op, extraClass = "") => {
    // 上下文行和 + 行取 after 的高亮，- 行取 before 的高亮
    const code = op.t === "-" ? beforeLines[aLine - 1] : afterLines[bLine - 1];
    const cells =
      op.t === "+"
        ? `<td className="gd-ln"></td><td className="gd-ln">${jsxText(String(bLine))}</td><td className="gd-sign">${jsxText("+")}</td>`
        : op.t === "-"
          ? `<td className="gd-ln">${jsxText(String(aLine))}</td><td className="gd-ln"></td><td className="gd-sign">${jsxText("−")}</td>`
          : `<td className="gd-ln">${jsxText(String(aLine))}</td><td className="gd-ln">${jsxText(String(bLine))}</td><td className="gd-sign"></td>`;
    const base = op.t === "+" ? "gd-add" : op.t === "-" ? "gd-del" : "";
    const cls = [base, extraClass].filter(Boolean).join(" ");
    rows.push(`<tr${cls ? ` className="${cls}"` : ""}>${cells}<td className="gd-code">${code ?? jsxText(" ")}</td></tr>`);
    if (op.t !== "+") aLine++;
    if (op.t !== "-") bLine++;
  };

  for (let k = 0; k < ops.length; ) {
    if (!hide[k]) {
      pushRow(ops[k]);
      k++;
      continue;
    }
    let j = k;
    while (j < ops.length && hide[j]) j++;
    const id = `gdf${foldSeq++}`;
    rows.push(
      `<tr className="gd-expand" data-fold="${id}"><td className="gd-ln" colSpan={2}>${jsxText("⇕")}</td><td className="gd-sign"></td><td className="gd-code">${jsxText(`展开 ${j - k} 行未变更代码`)}</td></tr>`,
    );
    for (; k < j; k++) pushRow(ops[k], `gd-fold ${id}`);
  }

  return [
    `<div className="gd-file">`,
    head(stats),
    `<div className="gd-body">`,
    // table 内部不能出现空白文本节点（React 对 <tbody> 里的文本会 hydration 失败、
    // 整块丢弃），所以所有行拼成一行、标签间零空白
    `<table className="gd-table"><tbody>${rows.join("")}</tbody></table>`,
    `</div>`,
    `</div>`,
  ];
}

// ---- MDX 生成 ----

async function generate(pair: DiffPair): Promise<void> {
  const excluded = (f: string) => pair.exclude?.some((p) => f === p || f.startsWith(`${p}/`)) ?? false;
  const beforeFiles = new Set(listFiles(pair.source).filter((f) => !excluded(f)));
  const afterFiles = new Set(listFiles(pair.target).filter((f) => !excluded(f)));

  const entries: Array<{ file: string; status: Status }> = [];
  for (const f of afterFiles) {
    if (!beforeFiles.has(f)) entries.push({ file: f, status: "新增" });
    else if (!readFileSync(join(ROOT, pair.source, f)).equals(readFileSync(join(ROOT, pair.target, f)))) {
      entries.push({ file: f, status: "修改" });
    }
  }
  for (const f of beforeFiles) {
    if (!afterFiles.has(f)) entries.push({ file: f, status: "删除" });
  }
  entries.sort((a, b) => rank(a.file, pair.order) - rank(b.file, pair.order) || a.file.localeCompare(b.file));

  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: "${pair.frontmatter.title}"`);
  if (pair.frontmatter.sidebarTitle) lines.push(`sidebarTitle: "${pair.frontmatter.sidebarTitle}"`);
  lines.push(`description: "${pair.frontmatter.description}"`);
  lines.push("---");
  lines.push("");
  lines.push(`{/* 本文件由 scripts/gen-diff-code.ts 生成（pnpm run gen:diff-code），不要手工编辑 */}`);
  lines.push("");
  lines.push(pair.intro);
  lines.push("");

  lines.push("## 文件清单");
  lines.push("");
  lines.push("```text");
  lines.push(renderTree(entries, basename(pair.target), pair.order));
  lines.push("```");
  lines.push("");

  const sectionOf = (file: string): number => {
    const i = pair.sections.findIndex((s) => s.files.some((prefix) => file === prefix || file.startsWith(prefix)));
    return i === -1 ? pair.sections.length - 1 : i;
  };

  for (let si = 0; si < pair.sections.length; si++) {
    const sectionEntries = entries.filter((e) => sectionOf(e.file) === si);
    if (sectionEntries.length === 0) continue;
    lines.push(`## ${pair.sections[si].title}`);
    lines.push("");
    for (const { file, status } of sectionEntries) {
      lines.push(...(await renderFileDiff(pair, file, status)));
      lines.push("");
    }
  }

  const outPath = join(ROOT, pair.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join("\n"));
  const counts = { 新增: 0, 修改: 0, 删除: 0 };
  for (const e of entries) counts[e.status]++;
  console.log(`已生成 ${pair.out}（新增 ${counts.新增}，修改 ${counts.修改}，删除 ${counts.删除}）`);
}

// ---- CSS 生成（GitHub PR 配色，浅色 + .dark 深色）----

function writeCss(): void {
  const scaffold = `/* 本文件由 scripts/gen-diff-code.ts 生成（pnpm run gen:diff-code），不要手工编辑 */
/* GitHub PR 式 diff 视图，配合生成的 diff MDX 页面使用 */

.gd-file {
  margin: 1rem 0;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  overflow: hidden;
  font-size: 12px;
}
.dark .gd-file { border-color: #30363d; }

.gd-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f6f8fa;
  border-bottom: 1px solid #d0d7de;
  user-select: none;
}
.dark .gd-head { background: #161b22; border-bottom-color: #30363d; }

.gd-name {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-weight: 600;
  color: #1f2328;
}
.dark .gd-name { color: #e6edf3; }

.gd-stats { margin-left: auto; font-weight: 600; display: flex; gap: 6px; }
.gd-plus { color: #1a7f37; }
.gd-minus { color: #cf222e; }
.dark .gd-plus { color: #3fb950; }
.dark .gd-minus { color: #f85149; }

.gd-body { overflow-x: auto; background: #ffffff; }
.dark .gd-body { background: #0d1117; }

.gd-note { padding: 12px; color: #656d76; background: #ffffff; }
.dark .gd-note { color: #8b949e; background: #0d1117; }

table.gd-table {
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 12px;
  line-height: 20px;
  display: table;
}
.gd-table tr { border: 0; background: transparent; }
.gd-table td { border: 0; padding: 0; background: transparent; }

td.gd-ln {
  width: 1%;
  min-width: 40px;
  padding: 0 10px;
  text-align: right;
  color: #656d76;
  user-select: none;
  vertical-align: top;
}
.dark td.gd-ln { color: #6e7681; }

td.gd-sign {
  width: 1%;
  padding: 0 4px;
  text-align: center;
  user-select: none;
  color: #1f2328;
  vertical-align: top;
}
.dark td.gd-sign { color: #e6edf3; }

td.gd-code {
  padding: 0 10px 0 4px;
  white-space: pre;
  color: #1f2328;
  tab-size: 2;
}
.dark td.gd-code { color: #e6edf3; }

/* 背景挂在 td 而不是 tr 上：tr 背景在 Safari / 非整数缩放下行间会出 hairline */
tr.gd-add td { background: #e6ffec; }
tr.gd-add td.gd-ln { background: #ccffd8; }
.dark tr.gd-add td { background: rgba(46, 160, 67, 0.15); }
.dark tr.gd-add td.gd-ln { background: rgba(63, 185, 80, 0.3); color: #c9d1d9; }

tr.gd-del td { background: #ffebe9; }
tr.gd-del td.gd-ln { background: #ffd7d5; }
.dark tr.gd-del td { background: rgba(248, 81, 73, 0.1); }
.dark tr.gd-del td.gd-ln { background: rgba(248, 81, 73, 0.3); color: #c9d1d9; }

/* 折叠的未变更行 + GitHub 式蓝色展开条（点击逻辑在 github-diff.js） */
tr.gd-fold { display: none; }
tr.gd-expand { cursor: pointer; }
tr.gd-expand td { background: #ddf4ff; }
tr.gd-expand td.gd-ln { color: #0969da; text-align: center; }
tr.gd-expand td.gd-code { color: #57606a; }
tr.gd-expand:hover td { background: #b6e3ff; }
.dark tr.gd-expand td { background: rgba(56, 139, 253, 0.15); }
.dark tr.gd-expand td.gd-ln { color: #58a6ff; }
.dark tr.gd-expand td.gd-code { color: #8b949e; }
.dark tr.gd-expand:hover td { background: rgba(56, 139, 253, 0.3); }
`;

  const paletteCss = [...palette.entries()]
    .map(([key, cls]) => {
      const [light, dark] = key.split("|");
      const rules: string[] = [];
      if (light) rules.push(`.${cls} { color: ${light}; }`);
      if (dark) rules.push(`.dark .${cls} { color: ${dark}; }`);
      return rules.join("\n");
    })
    .join("\n");

  writeFileSync(join(ROOT, CSS_OUT), `${scaffold}\n/* Shiki 调色板（github-light / github-dark） */\n${paletteCss}\n`);
  console.log(`已生成 ${CSS_OUT}（调色板 ${palette.size} 色）`);

  const js = `// 本文件由 scripts/gen-diff-code.ts 生成（pnpm run gen:diff-code），不要手工编辑
// GitHub 式 diff 展开条：点击后显示折叠的未变更行（配合 github-diff.css 的 .gd-fold）
document.addEventListener("click", (e) => {
  const tr = e.target && e.target.closest ? e.target.closest("tr.gd-expand") : null;
  if (!tr) return;
  const id = tr.getAttribute("data-fold");
  const tbody = tr.closest("tbody");
  if (!id || !tbody) return;
  tbody.querySelectorAll("tr." + id).forEach((row) => row.classList.remove("gd-fold"));
  tr.remove();
});
`;
  writeFileSync(join(ROOT, JS_OUT), js);
  console.log(`已生成 ${JS_OUT}`);
}

for (const pair of PAIRS) await generate(pair);
writeCss();
