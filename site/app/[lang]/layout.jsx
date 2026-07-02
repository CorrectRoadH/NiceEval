import "../globals.css";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale, locales } from "../../lib/content";

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }) {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return {
    title: {
      default: "NiceEval",
      template: "%s | NiceEval",
    },
    description: t.meta,
  };
}

export default async function LangLayout({ children, params }) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <html lang={lang === "zh" ? "zh-CN" : "en"} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
