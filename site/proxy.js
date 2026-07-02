import { NextResponse } from "next/server";
import { defaultLocale, locales } from "./lib/content";

const LOCALE_COOKIE = "niceeval-locale";

function detectLocale(request) {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (locales.includes(cookieLocale)) return cookieLocale;

  const acceptLanguage = request.headers.get("accept-language") ?? "";
  return acceptLanguage.toLowerCase().includes("zh") ? "zh" : defaultLocale;
}

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const hasLocalePrefix = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocalePrefix) return;

  const locale = detectLocale(request);
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // 跳过 _next 资源和任何带扩展名的静态文件(robots.txt、sitemap*.xml 等),避免它们被重定向到 /en/robots.txt。
  matcher: ["/((?!_next|.*\\..*).*)"],
};
