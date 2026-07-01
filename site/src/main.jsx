import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  FileCode2,
  Folder,
  GitFork,
  Play,
  Terminal,
  Wrench,
} from "lucide-react";
import "./styles.css";

const githubUrl = "https://github.com/CorrectRoadH/fasteval";

// 文档站按语言分入口：en 是默认语言走根路径，zh 走 /zh 前缀。
const docsUrl = {
  en: "https://fasteval.mintlify.site/quickstart",
  zh: "https://fasteval.mintlify.site/zh/quickstart",
};

const initPrompt =
  "READ https://raw.githubusercontent.com/CorrectRoadH/fasteval/refs/heads/main/INIT.md and install fasteval for this repo.";

const fileTree = {
  humans: [
    { path: "agents/web-agent.ts", depth: 0, kind: "file", note: "adapter" },
    { path: "evals/", depth: 0, kind: "folder" },
    { path: "weather-tool.eval.ts", depth: 1, kind: "file" },
    { path: "image-understanding.eval.ts", depth: 1, kind: "file" },
    { path: "experiments/compare-models/", depth: 0, kind: "folder" },
    { path: "fasteval.config.ts", depth: 0, kind: "file", note: "config" },
  ],
  agents: [
    { path: "PROMPT.md", depth: 0, kind: "file" },
    { path: "EVAL.ts", depth: 0, kind: "file" },
    { path: "__fasteval__/results.json", depth: 0, kind: "file" },
  ],
};

function fileIcon(item) {
  if (item.kind === "folder") return <Folder size={14} />;
  if (item.path.endsWith("config.ts")) return <Wrench size={14} />;
  if (item.path.endsWith(".json")) return <Terminal size={14} />;
  return <FileCode2 size={14} />;
}

const copy = {
  en: {
    meta: "fasteval is a lightweight TypeScript agent eval tool for agents, services, functions, and coding-agent fixtures.",
    navStart: "Start",
    docs: "Docs",
    languageLabel: "Switch language",
    modes: {
      humans: {
        label: "For humans",
        cta: "Docs",
        caption: "Read the quickstart guide, then write a TypeScript eval and run it across targets without building a bespoke harness.",
      },
      agents: {
        label: "For agents",
        command: initPrompt,
        caption: "Paste this prompt into your coding agent so it installs and wires up fasteval on its own.",
      },
    },
    heroTitle: "Lightweight agent evals for every project.",
    copyCommand: "Copy command",
    copied: "copied",
    primaryAction: "Start",
    github: "GitHub",
    visualLabel: "fasteval product diagram",
    fileCardRoot: "your-project/",
    fileNotes: {
      adapter: "adapter",
      config: "config",
    },
    runStatusPassed: "passed",
    scoreLabel: "Pass rate",
    workflowLabel: "fasteval workflow",
    steps: [
      ["Define", "Describe correct behavior in a small TypeScript file."],
      ["Run", "Use the same eval for agents, services, functions, or fixtures."],
      ["Inspect", "Read verdicts, traces, costs, and workspace evidence."],
    ],
    setupEyebrow: "Start",
    setupTitle: "Install. Init. Evaluate.",
    setupCard: {
      status: "ready",
      title: "fasteval quickstart",
      subtitle: "Three commands, zero config.",
      panelLabel: "terminal",
      rows: [
        {
          command: "npm install -D fasteval",
          note: "Adds fasteval as a dev dependency — no runtime deps land in your shipped app.",
        },
        {
          command: "npx fasteval init",
          note: "Scaffolds evals/weather.eval.ts and fasteval.config.ts to get you started.",
        },
        {
          command: "npx fasteval",
          note: "Runs every eval and prints pass rate, cost, and duration.",
        },
      ],
      moreLabel: "What you get",
      moreBody: "A local viewer with verdicts, traces, cost, and diffs for every run.",
    },
  },
  zh: {
    meta: "fasteval 是轻量、通用、DX 体验好的 TypeScript agent eval 工具，适合评 agents、services、functions 和 coding-agent fixtures。",
    navStart: "开始",
    docs: "文档",
    languageLabel: "切换语言",
    modes: {
      humans: {
        label: "给人类",
        cta: "文档",
        caption: "阅读快速开始文档，再写一个 TypeScript eval，在不同目标上运行，不用自建评测脚手架。",
      },
      agents: {
        label: "给 Agent",
        command: initPrompt,
        caption: "把这段 prompt 粘贴给你的 coding agent，让它自己安装并接入 fasteval。",
      },
    },
    heroTitle: "适合每个项目的轻量 Agent Evals。",
    copyCommand: "复制命令",
    copied: "已复制",
    primaryAction: "开始",
    github: "GitHub",
    visualLabel: "fasteval 产品示意图",
    fileCardRoot: "你的项目/",
    fileNotes: {
      adapter: "适配器",
      config: "配置",
    },
    runStatusPassed: "通过",
    scoreLabel: "通过率",
    workflowLabel: "fasteval 工作流",
    steps: [
      ["定义", "用一个小 TypeScript 文件描述什么算正确。"],
      ["运行", "同一个 eval 可评 agents、services、functions 或 fixtures。"],
      ["检查", "查看判决、trace、成本和工作区证据。"],
    ],
    setupEyebrow: "开始",
    setupTitle: "安装。初始化。开始评测。",
    setupCard: {
      status: "就绪",
      title: "fasteval 快速开始",
      subtitle: "三条命令，无需配置。",
      panelLabel: "终端",
      rows: [
        {
          command: "npm install -D fasteval",
          note: "把 fasteval 加为开发依赖——不给你部署的应用引入任何运行时依赖。",
        },
        {
          command: "npx fasteval init",
          note: "生成 evals/weather.eval.ts 和 fasteval.config.ts 脚手架，直接改着用。",
        },
        {
          command: "npx fasteval",
          note: "运行所有 eval，打印通过率、成本和耗时。",
        },
      ],
      moreLabel: "你会得到什么",
      moreBody: "一个本地查看器，展示每次运行的判决、trace、成本和 diff。",
    },
  },
};

function detectLocale() {
  let saved;
  try {
    saved = window.localStorage.getItem("fasteval-locale");
  } catch {
    saved = undefined;
  }
  if (saved === "zh" || saved === "en") return saved;
  return window.navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function App() {
  const [locale, setLocale] = useState(detectLocale);
  const t = copy[locale];

  useEffect(() => {
    try {
      window.localStorage.setItem("fasteval-locale", locale);
    } catch {
      // Language selection still works for the current session.
    }
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.querySelector('meta[name="description"]')?.setAttribute("content", t.meta);
  }, [locale, t.meta]);

  return (
    <>
      <Header locale={locale} setLocale={setLocale} t={t} />
      <main>
        <Hero t={t} locale={locale} />
        <Strip t={t} />
        <Setup t={t} />
      </main>
    </>
  );
}

function Header({ locale, setLocale, t }) {
  const nextLocale = locale === "en" ? "zh" : "en";

  return (
    <header className="topbar shell">
      <a className="brand" href="#top" aria-label="fasteval home">
        <span className="mark" />
        <span>fasteval</span>
      </a>
      <nav className="nav" aria-label="Primary">
        <a href="#setup">{t.navStart}</a>
        <a href={docsUrl[locale]}>{t.docs}</a>
        <a href={githubUrl}>{t.github}</a>
        <button type="button" className="lang-toggle" aria-label={t.languageLabel} onClick={() => setLocale(nextLocale)}>
          {nextLocale === "zh" ? "中文" : "EN"}
        </button>
      </nav>
    </header>
  );
}

function Hero({ t, locale }) {
  const [mode, setMode] = useState("humans");
  const [copied, setCopied] = useState(false);
  const active = t.modes[mode];
  const copyCommand = async () => {
    try {
      await navigator.clipboard?.writeText(active.command);
    } catch {
      // Some browsers block clipboard access outside secure contexts.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section id="top" className="hero shell">
      <div className="hero-copy">
        <div className="logo-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>{t.heroTitle}</h1>
        <div className="mode-switch" aria-label="Audience">
          {Object.entries(t.modes).map(([key, item]) => (
            <button
              key={key}
              type="button"
              className={key === mode ? "active" : ""}
              onClick={() => setMode(key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode === "humans" ? (
          <a className="button primary docs-cta" href={docsUrl[locale]} target="_blank" rel="noreferrer">
            <BookOpen size={16} />
            {active.cta}
          </a>
        ) : (
          <div className="copy-row">
            <code>{active.command}</code>
            <button type="button" aria-label={t.copyCommand} onClick={copyCommand}>
              <Clipboard size={16} />
            </button>
            <span className={copied ? "copy-status visible" : "copy-status"}>{t.copied}</span>
          </div>
        )}
        <p className="lede">{active.caption}</p>
        <div className="actions">
          <a className="button primary" href="#setup">
            <Play size={15} />
            {t.primaryAction}
          </a>
          <a className="button ghost" href={githubUrl}>
            <GitFork size={15} />
            {t.github}
          </a>
        </div>
      </div>

      <ProductVisual mode={mode} t={t} />
    </section>
  );
}

function ProductVisual({ mode, t }) {
  return (
    <div className="visual" aria-label={t.visualLabel}>
      <div className="wire a" />
      <div className="wire b" />
      <div className="wire c" />
      <div className="file-card">
        <div className="card-head">
          <Folder size={18} />
          <span>{t.fileCardRoot}</span>
        </div>
        <ul>
          {fileTree[mode].map((item) => (
            <li key={item.path} className={item.depth ? "indent" : undefined}>
              {fileIcon(item)}
              <span>{item.path}</span>
              {item.note ? <em>{t.fileNotes[item.note]}</em> : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="run-card">
        <code>$ fasteval</code>
        <div className="run-line">
          <CheckCircle2 size={16} />
          <span>weather</span>
          <b>{t.runStatusPassed}</b>
        </div>
        <div className="run-line">
          <CheckCircle2 size={16} />
          <span>fixtures/button</span>
          <b>91.7%</b>
        </div>
      </div>
      <div className="score-card">
        <span>{t.scoreLabel}</span>
        <strong>91.7%</strong>
        <div className="score-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

function Strip({ t }) {
  return (
    <section className="strip shell" aria-label={t.workflowLabel}>
      {t.steps.map(([title, text], index) => (
        <Step key={title} k={String(index + 1)} title={title} text={text} />
      ))}
    </section>
  );
}

function Step({ k, title, text }) {
  return (
    <article>
      <span>{k}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

function Setup({ t }) {
  return (
    <section id="setup" className="setup shell">
      <div>
        <p className="eyebrow">{t.setupEyebrow}</p>
        <h2>{t.setupTitle}</h2>
      </div>
      <SetupCard card={t.setupCard} />
    </section>
  );
}

function SetupCard({ card }) {
  const [openRows, setOpenRows] = useState(() => new Set());
  const [moreOpen, setMoreOpen] = useState(false);

  const toggleRow = (index) => {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="setup-card">
      <div className="setup-card-head">
        <span className="pill">{card.status}</span>
        <h3>{card.title}</h3>
        <p>{card.subtitle}</p>
      </div>
      <div className="setup-panel">
        <div className="setup-panel-head">
          <Terminal size={14} />
          <span>{card.panelLabel}</span>
        </div>
        <ol>
          {card.rows.map((row, index) => {
            const open = openRows.has(index);
            return (
              <li key={row.command}>
                <button type="button" className="setup-row" aria-expanded={open} onClick={() => toggleRow(index)}>
                  <span className="num">{index + 1}</span>
                  <ChevronRight size={14} className={open ? "chev open" : "chev"} />
                  <code>{row.command}</code>
                </button>
                {open ? (
                  <p className="setup-note">
                    <CheckCircle2 size={13} />
                    <span>{row.note}</span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      <button type="button" className="setup-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
        <ChevronRight size={13} className={moreOpen ? "chev open" : "chev"} />
        {card.moreLabel}
      </button>
      {moreOpen ? <p className="setup-more-body">{card.moreBody}</p> : null}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
