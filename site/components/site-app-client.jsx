"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Highlight, themes } from "prism-react-renderer";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Clipboard,
  FileCode2,
  Folder,
  GitCompare,
  GitFork,
  MessageCircle,
  Play,
  Terminal,
  Wrench,
} from "lucide-react";
import { initAnalytics, track } from "../src/analytics";
import { evalExamples } from "../src/eval-examples";
import { compareCard, docsUrl, fileTree, githubUrl, otherLocale, withLocale } from "../lib/content";

const LOCALE_COOKIE = "niceeval-locale";

function fileIcon(item) {
  if (item.kind === "folder") return <Folder size={14} />;
  if (item.path.endsWith("config.ts")) return <Wrench size={14} />;
  if (item.path.endsWith(".json")) return <Terminal size={14} />;
  return <FileCode2 size={14} />;
}

function getBlogPost(blogPosts, slug) {
  return blogPosts.find((post) => post.slug === slug);
}

const codeTheme = {
  ...themes.vsDark,
  plain: { ...themes.vsDark.plain, backgroundColor: "transparent" },
};

// route 里的相对路径,用来拼当前页在另一种语言下的对应 URL。
function routeHref(locale, route) {
  if (route.name === "blog") return withLocale(locale, "blog");
  if (route.name === "post") return withLocale(locale, `blog/${route.slug}`);
  return withLocale(locale);
}

function rememberLocale(locale) {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000`;
  } catch {
    // Language switching still works for this navigation even if the cookie can't be set.
  }
}

export default function SiteAppClient({ lang, t, initialRoute, blogPosts }) {
  const locale = lang;
  const route = initialRoute;

  useEffect(() => {
    initAnalytics();
    if (process.env.NODE_ENV === "development") {
      import("react-grab");
    }
  }, []);

  return (
    <>
      <Header locale={locale} t={t} route={route} />
      <main>
        {route.name === "home" ? (
          <>
            <Hero t={t} locale={locale} />
            <Strip t={t} />
            <Setup t={t} locale={locale} />
          </>
        ) : route.name === "blog" ? (
          <BlogIndex t={t} locale={locale} blogPosts={blogPosts} />
        ) : (
          <BlogArticle t={t} locale={locale} route={route} blogPosts={blogPosts} />
        )}
      </main>
    </>
  );
}

function Header({ locale, t, route }) {
  const nextLocale = otherLocale(locale);
  const startHref = route.name === "home" ? "#setup" : `${withLocale(locale)}#setup`;

  return (
    <header className="topbar shell">
      <Link
        className="brand"
        href={withLocale(locale)}
        aria-label="NiceEval home"
        onClick={() => track("Click Home Link", { location: "header" })}
      >
        <span className="mark" />
        <span>NiceEval</span>
      </Link>
      <nav className="nav" aria-label="Primary">
        <Link href={startHref} onClick={() => track("Click Nav Start")}>
          {t.navStart}
        </Link>
        <Link
          href={withLocale(locale, "blog")}
          onClick={() => track("Click Blog Link", { location: "header", locale })}
        >
          {t.blog}
        </Link>
        <a href={docsUrl[locale]} onClick={() => track("Click Docs Link", { location: "header", locale })}>{t.docs}</a>
        <a href={githubUrl} onClick={() => track("Click GitHub Link", { location: "header" })}>{t.github}</a>
        <Link
          className="lang-toggle"
          aria-label={t.languageLabel}
          href={routeHref(nextLocale, route)}
          onClick={() => {
            track("Switch Language", { from: locale, to: nextLocale });
            rememberLocale(nextLocale);
          }}
        >
          {nextLocale === "zh" ? "中文" : "EN"}
        </Link>
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
          {Object.entries(t.modes).map(([key, item]) => (
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

function BlogIndex({ t, locale, blogPosts }) {
  const post = blogPosts[0];
  const postCopy = post[locale];

  return (
    <section className="blog-page shell">
      <div className="blog-hero">
        <p className="eyebrow">{t.blogPage.eyebrow}</p>
        <h1>{t.blogPage.title}</h1>
        <p>{t.blogPage.intro}</p>
      </div>
      <div className="blog-section-head">
        <h2>{t.blogPage.latest}</h2>
      </div>
      <article className="blog-card">
        <div className="blog-card-art" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="blog-card-copy">
          <span className="post-kicker">{postCopy.category}</span>
          <h2>{postCopy.title}</h2>
          <p>{postCopy.description}</p>
          <PostMeta post={post} postCopy={postCopy} t={t} />
          <Link
            className="button primary"
            href={withLocale(locale, `blog/${post.slug}`)}
            onClick={() => track("Open Blog Post", { slug: post.slug, locale })}
          >
            {t.blogPage.read}
            <ChevronRight size={15} />
          </Link>
        </div>
      </article>
    </section>
  );
}

function BlogArticle({ t, locale, route, blogPosts }) {
  const post = getBlogPost(blogPosts, route.slug);

  if (!post) {
    return (
      <section className="blog-page shell">
        <BlogBackLink t={t} locale={locale} />
        <div className="blog-hero">
          <h1>{t.blogPage.notFound}</h1>
        </div>
      </section>
    );
  }

  const postCopy = post[locale];

  return (
    <article className="article-page shell">
      <BlogBackLink t={t} locale={locale} />
      <header className="article-header">
        <div>
          <span className="post-kicker">{postCopy.category}</span>
          <h1>{postCopy.title}</h1>
          <p>{postCopy.description}</p>
          <PostMeta post={post} postCopy={postCopy} t={t} />
        </div>
        <div className="article-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </header>
      <MdxBody source={postCopy.body} />
    </article>
  );
}

function BlogBackLink({ t, locale }) {
  return (
    <Link className="back-link" href={withLocale(locale, "blog")} onClick={() => track("Back To Blog")}>
      <ArrowLeft size={15} />
      {t.blogPage.back}
    </Link>
  );
}

function PostMeta({ post, postCopy, t }) {
  return (
    <div className="post-meta">
      <span>
        <CalendarDays size={14} />
        {postCopy.date}
      </span>
      <span>
        <Clock3 size={14} />
        {postCopy.readMinutes} {t.blogPage.minutes}
      </span>
      <span>{postCopy.category}</span>
    </div>
  );
}

function MdxBody({ source }) {
  const blocks = parseMarkdownBlocks(source);

  return (
    <div className="article-body">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const HeadingTag = `h${block.level}`;
          return <HeadingTag key={index}>{formatInline(block.text)}</HeadingTag>;
        }
        if (block.type === "quote") {
          return <blockquote key={index}>{formatInline(block.text)}</blockquote>;
        }
        if (block.type === "list") {
          return (
            <ul key={index}>
              {block.items.map((item) => (
                <li key={item}>{formatInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "code") {
          return <pre key={index}><code>{block.text}</code></pre>;
        }
        return <p key={index}>{formatInline(block.text)}</p>;
      })}
    </div>
  );
}

function parseMarkdownBlocks(source) {
  const lines = source.trim().split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let code = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: line.slice(2) });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

function formatInline(text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
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

function Setup({ t, locale }) {
  const [activeId, setActiveId] = useState(evalExamples[0].id);
  // 自动轮播:进入视口才转,悬停在卡组上暂停;用户任何点击不停止轮播,只把倒计时清零重来。
  const [resetKey, setResetKey] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [inView, setInView] = useState(false);
  const sectionRef = useRef(null);
  const activeIndex = evalExamples.findIndex((example) => example.id === activeId);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hovering || !inView) return undefined;
    const timer = window.setInterval(() => {
      setActiveId((prev) => {
        const index = evalExamples.findIndex((example) => example.id === prev);
        return evalExamples[(index + 1) % evalExamples.length].id;
      });
    }, 6500);
    return () => window.clearInterval(timer);
  }, [hovering, inView, resetKey]);

  const activate = (id, source) => {
    setResetKey((key) => key + 1);
    if (id === activeId) return;
    track("Switch Eval Example", { id, source, locale });
    setActiveId(id);
  };

  return (
    <section id="setup" className="setup shell" ref={sectionRef}>
      <div className="setup-intro">
        <p className="eyebrow">{t.setupEyebrow}</p>
        <h2>{t.setupTitle}</h2>
        <p className="setup-caption">{t.setupCaption}</p>
        <div className="deck-switch" role="tablist" aria-label={t.setupEyebrow}>
          {evalExamples.map((example) => (
            <button
              key={example.id}
              type="button"
              role="tab"
              aria-selected={example.id === activeId}
              className={example.id === activeId ? "active" : undefined}
              onClick={() => activate(example.id, "switcher")}
            >
              <span className="deck-tag">{example[locale].tag}</span>
              <span>{example[locale].label}</span>
            </button>
          ))}
        </div>
      </div>
      <div
        className="eval-deck"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClickCapture={() => setResetKey((key) => key + 1)}
      >
        {evalExamples.map((example, index) => (
          <EvalCard
            key={example.id}
            t={t}
            example={example}
            locale={locale}
            active={example.id === activeId}
            offset={(index - activeIndex + evalExamples.length) % evalExamples.length}
            onActivate={() => activate(example.id, "card")}
          />
        ))}
      </div>
    </section>
  );
}

function EvalCard({ t, example, locale, active, offset, onActivate }) {
  const [openLines, setOpenLines] = useState(() => new Set());
  const [timingOpen, setTimingOpen] = useState(false);
  const card = example[locale];
  const meta = example.meta;

  const toggleLine = (lineNo, noteKey) => {
    setOpenLines((prev) => {
      const next = new Set(prev);
      const opening = !next.has(lineNo);
      if (opening) next.add(lineNo);
      else next.delete(lineNo);
      track("Toggle Eval Code Note", { example: example.id, noteKey, open: opening });
      return next;
    });
  };

  return (
    // 后排卡片只当"切换到这个示例"的按钮用:整卡可点,内容对读屏和 Tab 键隐藏(键盘走左侧 tablist)。
    <div
      className={active ? "setup-card deck-card active" : `setup-card deck-card deck-pos-${offset}`}
      aria-hidden={active ? undefined : true}
      onClick={active ? undefined : onActivate}
    >
      <div className="setup-card-head">
        <div className="setup-card-title">
          <span className="deck-tag">{card.tag}</span>
          <span className="deck-label">{card.label}</span>
        </div>
        <span className="pill">{t.runStatusPassed}</span>
      </div>
      <div className="setup-panel">
        <Highlight code={card.lines.join("\n")} language="tsx" theme={codeTheme}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre className={`eval-code ${className}`} style={style}>
              {tokens.map((line, i) => {
                const lineNo = i + 1;
                const noteKey = active ? meta.highlights[lineNo] : undefined;
                const isReply = noteKey ? meta.replyKeys.includes(noteKey) : false;
                const open = openLines.has(lineNo);
                const lineClassName = noteKey ? `code-line interactive ${isReply ? "reply" : "assertion"}` : "code-line";
                return (
                  <React.Fragment key={lineNo}>
                    <div
                      {...getLineProps({ line, className: lineClassName })}
                      role={noteKey ? "button" : undefined}
                      tabIndex={noteKey ? 0 : undefined}
                      aria-expanded={noteKey ? open : undefined}
                      onClick={noteKey ? () => toggleLine(lineNo, noteKey) : undefined}
                      onKeyDown={
                        noteKey
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleLine(lineNo, noteKey);
                              }
                            }
                          : undefined
                      }
                    >
                      <span className="code-line-no">
                        {noteKey ? isReply ? <MessageCircle size={12} /> : <CheckCircle2 size={12} /> : lineNo}
                      </span>
                      <span className="code-line-content">
                        {line.map((token, tokenIndex) => (
                          <span key={tokenIndex} {...getTokenProps({ token })} />
                        ))}
                      </span>
                      {noteKey ? (
                        <span className="code-line-actions">
                          {lineNo === meta.gateLine ? <span className="gate-badge">{meta.gateBadge}</span> : null}
                          <ChevronRight size={12} className={open ? "chev open" : "chev"} aria-hidden="true" />
                        </span>
                      ) : null}
                    </div>
                    {noteKey && open ? (
                      <div className={`code-note ${isReply ? "code-note-reply" : ""}`}>
                        {isReply ? <span className="code-note-role">assistant</span> : <CheckCircle2 size={13} />}
                        <span>{card.notes[noteKey]}</span>
                      </div>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>
      <button
        type="button"
        className="eval-more"
        aria-expanded={timingOpen}
        tabIndex={active ? undefined : -1}
        onClick={
          active
            ? () =>
                setTimingOpen((v) => {
                  track("Toggle Timing Trace", { example: example.id, open: !v });
                  return !v;
                })
            : undefined
        }
      >
        <ChevronRight size={13} className={timingOpen ? "chev open" : "chev"} />
        {t.timingLabel}
      </button>
      {timingOpen ? (
        <div className="eval-more-body">
          <ul className="eval-timing">
            {card.timingRows.map((row) => (
              <li key={row.label}>
                <span>{row.label}</span>
                <b>{row.value}</b>
              </li>
            ))}
          </ul>
          <p className="eval-timing-total">{card.timingTotal}</p>
        </div>
      ) : null}
    </div>
  );
}
