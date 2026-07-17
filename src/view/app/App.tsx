import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectLocale, makeTranslator, persistLocale, setDocumentLocale } from "./i18n.ts";
import type { Locale, LocalizedText, ReportSlotHtml, Tab, ViewData, ViewReportPageMeta, ViewResult } from "./types.ts";
import { resultFromUrl } from "./lib/rows.ts";
import { parseAttemptHash, resolveAttemptLocator, unresolvedAttemptWarning } from "./lib/attempt-route.ts";
import { AttemptModal } from "./components/AttemptModal.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";

// 导航组成只有一条规则(docs/feature/reports/view.md「页面构成」):导航项 = 报告定义声明的页,
// 按声明顺序排列(路由 `#/page/<id>`,`--page <id>` 定初始页)。宿主不追加、不保留任何导航项——
// 裸 view 的「报告 / Attempts / 追踪」三个 tab 就是内建报告的三页。页面里的 hero、Scope 警告
// 都不是宿主渲染的:它们是页内的站点组件(Hero / ScopeWarnings)。宿主保留的是机器
// 加一个恒定的品牌位:管线与路由、attempt 详情路由、文档单例(<title>)、语言切换,以及
// 页头左端的 NiceEval 字标(docs/feature/reports/architecture.md「宿主保留的只有机器」)。

// niceeval 官网。页头品牌字标与 hero 下的 `Powered by NiceEval` 行都外链到它,
// utm_medium 区分点击来自哪个品牌位(shell.md「行为约束」)。
const BRAND_HREF = "https://niceeval.com/?utm_source=report&utm_medium=brand";

/**
 * LocalizedText 的确定回退(docs/feature/reports/library/shell.md):当前 locale → en →
 * 按 locale 键字典序的第一个非空值。字符串原样返回。
 */
export function localizedText(text: LocalizedText | undefined, locale: Locale): string | undefined {
  if (!text) return undefined;
  if (typeof text === "string") return text;
  if (text[locale]) return text[locale];
  if (text.en) return text.en;
  for (const key of Object.keys(text).sort()) {
    if (text[key]) return text[key];
  }
  return undefined;
}

/** 初始 URL → 直接打开的 attempt:先认 #/attempt/@<locator> 深链,回退旧版 ?modal= 参数。 */
function modalResultFromLocation(snapshots: ViewData["snapshots"]): ViewResult | null {
  const locator = parseAttemptHash(location.hash);
  if (locator) {
    const found = resolveAttemptLocator(snapshots, locator);
    if (found) return found;
    // 定位不到(locator 不在、快照未加载、旧格式数据):不开空 modal,页面照常渲染。
    console.warn(unresolvedAttemptWarning(location.hash));
    return null;
  }
  return resultFromUrl(snapshots);
}

/**
 * 报告槽:React 19 对 dangerouslySetInnerHTML 只比较对象身份,身份一变就无条件重设
 * innerHTML(不再比对 __html 字符串值)。{__html} 必须 memo 住,否则 App 任意一次重渲染
 * (开关 attempt 弹窗、切语言)都会重建槽内 DOM,丢掉用户展开的 <details>、排序和过滤状态。
 */
function ReportSlot({ html }: { html: string }) {
  const markup = useMemo(() => ({ __html: html }), [html]);
  return <div className="report-slot" dangerouslySetInnerHTML={markup} />;
}

/** `#/page/<id>` → tab 值;认不出返回 null(交给初始页兜底)。 */
function tabFromHash(hash: string, pages: ViewReportPageMeta[]): Tab | null {
  const pageMatch = /^#\/page\/([a-z0-9-]+)$/.exec(hash);
  if (pageMatch && pages.some((p) => p.id === pageMatch[1])) return `page:${pageMatch[1]}`;
  return null;
}

/** tab 值 → hash 路由(报告页 `#/page/<id>`)。 */
function hashForTab(tab: Tab): string {
  return `#/page/${tab.slice("page:".length)}`;
}

export function App({ data, reportPages }: { data: ViewData; reportPages: Record<string, ReportSlotHtml> }) {
  const snapshots = data.snapshots ?? [];
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const t = useMemo(() => makeTranslator(locale), [locale]);

  // 报告声明缺省(旧数据 / 空烘焙)时按单页 `report` 兜底,页名用内置页名。
  const pages: ViewReportPageMeta[] = data.report?.pages?.length
    ? data.report.pages
    : [{ id: "report", title: { en: "Report", "zh-CN": "报告" } }];
  const initialPageId = data.report?.initialPageId ?? pages[0]!.id;

  const [tab, setTab] = useState<Tab>(() => tabFromHash(location.hash, pages) ?? `page:${initialPageId}`);
  const [modalResult, setModalResult] = useState<ViewResult | null>(() => modalResultFromLocation(snapshots));
  // 当前 modal 的 hash 历史条目前面是否还有本页条目(本页 push 的 / 前进键回到的):
  // true → UI 关闭走 history.back(),前进键还能重新打开;false(深链直接落地)→ 原地抹 hash,
  // 免得 back 把用户弹出站外。
  const modalOwnsHistory = useRef(false);

  useEffect(() => {
    setDocumentLocale(locale);
    persistLocale(locale);
  }, [locale]);

  // 浏览器标题是宿主文档单例:跟随外壳标题(回退链在 server 侧走完:def.title →
  // 唯一快照 name → 内置文案「Eval 运行结果 / Eval Results」);缺声明(旧数据)时按内置文案兜底。
  // 页面里的 hero 标题不归宿主——它是页内 Hero 组件,同一取值链经 ctx.report.title 贯通。
  const shellTitle = localizedText(data.report?.title, locale) ?? t("hero.title");
  useEffect(() => {
    document.title = shellTitle;
  }, [shellTitle]);

  const closeModal = useCallback(() => {
    setModalResult(null);
    if (modalOwnsHistory.current) {
      modalOwnsHistory.current = false;
      history.back();
      return;
    }
    try {
      // 深链直接落地 / 旧版 ?modal= 链接:没有可回退的本页条目,原地还原成无 modal 的 URL。
      history.replaceState(null, "", location.pathname);
    } catch {
      // 还原 URL 失败不影响关闭。
    }
  }, []);

  // 浏览器前进/后退、手改 hash、页内链接(attempt 深链与 `#/page/<id>` 页路由)统一从
  // hashchange 分发:attempt hash 开证据室弹窗,页 hash 切当前 tab。
  // attempt 详情路由对完整结果根解析(viewData.snapshots 全量通道):被位置参数 / --experiment
  // 收窄滤掉的 attempt 仍能经深链打开,报告里的证据引用不因页面过滤失效。
  useEffect(() => {
    const onHashChange = () => {
      const locator = parseAttemptHash(location.hash);
      if (locator) {
        const found = resolveAttemptLocator(snapshots, locator);
        if (!found) {
          console.warn(unresolvedAttemptWarning(location.hash));
          setModalResult(null);
          return;
        }
        // 经浏览器导航打开:前一条历史仍是本页,UI 关闭可以安全 back()。
        modalOwnsHistory.current = true;
        setModalResult(found);
        return;
      }
      modalOwnsHistory.current = false;
      setModalResult(null);
      const routed = tabFromHash(location.hash, pages);
      if (routed) setTab(routed);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [snapshots, pages]);

  const selectTab = useCallback((value: Tab) => {
    setTab(value);
    try {
      history.replaceState(null, "", hashForTab(value));
    } catch {
      // 更新路由失败不影响切页。
    }
  }, []);

  const footerText = localizedText(data.report?.footer, locale);

  return (
    <Tabs value={tab} onValueChange={(v) => selectTab(v as Tab)}>
      <header className="topbar">
        {/* 页头左端是恒定的 NiceEval 品牌字标(与 Powered by 行同族的产品品牌位),
            报告定义不能覆盖或移除,点击外链官网;报告 title 的落点是页内 hero 与浏览器标题。
            rel 用 noopener 而非 noreferrer:保留 Referer(默认策略只发 origin),官网统计由此
            得知点击来自哪个报告站点;utm 只负责区分品牌位。 */}
        <a className="brand" href={BRAND_HREF} target="_blank" rel="noopener">
          <span className="mark" aria-hidden="true" />
          <span>NiceEval</span>
        </a>
        <TabsList aria-label={t("nav.label")}>
          {pages.map((page) => (
            <TabsTrigger key={`page:${page.id}`} value={`page:${page.id}`}>
              {localizedText(page.title, locale) ?? page.id}
            </TabsTrigger>
          ))}
        </TabsList>
        {data.report?.links?.length ? (
          <nav className="shell-links" aria-label="Links">
            {data.report.links.map((link, i) => (
              <a key={i} href={link.href} target="_blank" rel="noreferrer">
                {/* 内联 SVG 字标(可选)渲染在 label 前,原样内联;内容是作者义务,宿主不校验形状之外的东西。 */}
                {link.icon ? (
                  <span className="shell-link-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: link.icon.svg }} />
                ) : null}
                {localizedText(link.label, locale) ?? link.href}
              </a>
            ))}
          </nav>
        ) : null}
        <div className="lang-switch" aria-label="Language">
          {(["en", "zh-CN"] satisfies Locale[]).map((item) => (
            <button
              key={item}
              className={locale === item ? "is-active" : ""}
              type="button"
              onClick={() => setLocale(item)}
              aria-pressed={locale === item}
            >
              {item === "zh-CN" ? "中文" : "EN"}
            </button>
          ))}
        </div>
      </header>
      <main>
        {pages.map((page) => (
          <TabsContent key={`page:${page.id}`} value={`page:${page.id}`} id={`tab-page-${page.id}`}>
            {/* 报告槽:server 侧逐页渲染好的静态 HTML(含 <Style> 产物),按当前页与界面语言
                摆放对应块;hero、品牌行、Scope 警告、批量修复 prompt 都是页内组件,壳不再渲染。
                attempt 深链是普通 <a href="#/attempt/…">,经 hashchange 打开证据室弹窗。 */}
            <ReportSlot html={reportPages[page.id]?.[locale] || reportPages[page.id]?.en || ""} />
          </TabsContent>
        ))}
      </main>
      {footerText ? (
        <footer className="site-footer">
          <span className="site-footer-text">{footerText}</span>
        </footer>
      ) : null}
      {modalResult && <AttemptModal result={modalResult} onClose={closeModal} t={t} />}
    </Tabs>
  );
}
