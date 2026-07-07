"use client";

import React, { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { CheckCircle2, ChevronRight, MessageCircle } from "lucide-react";
import { track } from "../src/analytics";
import { evalExamples, type EvalExample } from "../src/eval-examples";
import type { Dictionary, Locale } from "../lib/content";

const codeTheme = {
  ...themes.vsDark,
  plain: { ...themes.vsDark.plain, backgroundColor: "transparent" },
};

// 首页最重的区块(prism 高亮 + 示例数据),独立成 chunk 由 next/dynamic 加载,
// 不占首屏 LCP 的启动 JS 关键路径。
export default function Setup({ t, locale }: { t: Dictionary; locale: Locale }) {
  const [activeId, setActiveId] = useState(evalExamples[0].id);
  // 自动轮播:进入视口才转,悬停在卡组上暂停;用户任何点击不停止轮播,只把倒计时清零重来。
  const [resetKey, setResetKey] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [inView, setInView] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
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

  const activate = (id: string, source: "switcher" | "card") => {
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

function EvalCard({
  t,
  example,
  locale,
  active,
  offset,
  onActivate,
}: {
  t: Dictionary;
  example: EvalExample;
  locale: Locale;
  active: boolean;
  offset: number;
  onActivate: () => void;
}) {
  const [openLines, setOpenLines] = useState<Set<number>>(() => new Set());
  const [timingOpen, setTimingOpen] = useState(false);
  const card = example[locale];
  const meta = example.meta;

  const toggleLine = (lineNo: number, noteKey: string) => {
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
                          ? (event: KeyboardEvent<HTMLDivElement>) => {
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
