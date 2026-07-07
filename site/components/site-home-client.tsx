"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Clipboard,
  FileCode2,
  Folder,
  GitCompare,
  GitFork,
  Play,
  Terminal,
  Wrench,
} from "lucide-react";
import { initAnalytics, track } from "../src/analytics";
import { compareCard, fileTree, githubUrl, docsUrl, withLocale, type Dictionary, type FileTreeItem, type Locale } from "../lib/content";
import { Header } from "./site-header";
import Link from "next/link";
import dynamic from "next/dynamic";

// Setup 是首页最重的区块(prism 高亮 + 示例数据),拆成独立 chunk 异步 hydrate,
// 把它的 JS 挪出 LCP 关键路径;SSR 照常输出,不影响 SEO 文本。
const Setup = dynamic(() => import("./site-home-setup"));

type AudienceMode = "humans" | "agents";

function fileIcon(item: FileTreeItem) {
  if (item.kind === "folder") return <Folder size={14} />;
  if (item.path.endsWith("config.ts")) return <Wrench size={14} />;
  if (item.path.endsWith(".json")) return <Terminal size={14} />;
  return <FileCode2 size={14} />;
}

export default function HomeClient({ t, locale }: { t: Dictionary; locale: Locale }) {
  useEffect(() => {
    initAnalytics();
    if (process.env.NODE_ENV === "development") {
      import("react-grab");
    }
  }, []);

  return (
    <>
      <Header locale={locale} t={t} route={{ name: "home" }} />
      <main>
        <Hero t={t} locale={locale} />
        <Strip t={t} />
        <Setup t={t} locale={locale} />
      </main>
    </>
  );
}

function Hero({ t, locale }: { t: Dictionary; locale: Locale }) {
  const [mode, setMode] = useState<AudienceMode>("humans");
  const [copied, setCopied] = useState(false);
  const active = t.modes[mode];
  const agentMode = t.modes.agents;
  const humanMode = t.modes.humans;
  const copyCommand = async () => {
    try {
      await navigator.clipboard?.writeText(agentMode.command);
    } catch {
      // Some browsers block clipboard access outside secure contexts.
    }
    track("Copy Init Command", { locale });
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
          {(Object.entries(t.modes) as Array<[AudienceMode, (typeof t.modes)[AudienceMode]]>).map(([key, item]) => (
            <button
              key={key}
              type="button"
              className={key === mode ? "active" : ""}
              onClick={() => {
                track("Switch Audience Mode", { mode: key, locale });
                setMode(key);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode === "humans" ? (
          <a
            className="button primary docs-cta"
            href={docsUrl[locale]}
            target="_blank"
            rel="noreferrer"
            onClick={() => track("Click Docs Link", { location: "hero", locale })}
          >
            <BookOpen size={16} />
            {humanMode.cta}
          </a>
        ) : (
          <div className="copy-row">
            <code>{agentMode.command}</code>
            <button type="button" aria-label={t.copyCommand} onClick={copyCommand}>
              <Clipboard size={16} />
            </button>
            <span className={copied ? "copy-status visible" : "copy-status"}>{t.copied}</span>
          </div>
        )}
        <p className="lede">{active.caption}</p>
        <div className="actions">
          <a className="button primary" href="#setup" onClick={() => track("Click Primary CTA", { mode, locale })}>
            <Play size={15} />
            {t.primaryAction}
          </a>
          <a className="button ghost" href={githubUrl} onClick={() => track("Click GitHub Link", { location: "hero" })}>
            <GitFork size={15} />
            {t.github}
          </a>
          <Link
            className="button ghost"
            href={withLocale(locale, "blog")}
            onClick={() => track("Click Blog Link", { location: "hero", locale })}
          >
            <BookOpen size={15} />
            {t.blog}
          </Link>
        </div>
      </div>

      <ProductVisual mode={mode} t={t} />
    </section>
  );
}

function ProductVisual({ mode, t }: { mode: AudienceMode; t: Dictionary }) {
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
        <code>$ niceeval</code>
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
        <div className="compare-head">
          <GitCompare size={14} />
          <span>{compareCard.group}</span>
        </div>
        <ul className="compare-rows">
          {compareCard.rows.map((row) => (
            <li key={row.name} className={row.score < 90 ? "warn" : undefined}>
              <div className="compare-row-top">
                <span>{row.name}</span>
                <b>{row.score}%</b>
              </div>
              <div className="compare-bar">
                <i style={{ width: `${row.score}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Strip({ t }: { t: Dictionary }) {
  return (
    <section className="strip shell" aria-label={t.workflowLabel}>
      {t.steps.map(([title, text], index) => (
        <Step key={title} k={String(index + 1)} title={title} text={text} />
      ))}
    </section>
  );
}

function Step({ k, title, text }: { k: string; title: string; text: string }) {
  return (
    <article>
      <span>{k}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}
