import { notFound } from "next/navigation";
import SiteAppClient from "../../components/site-app-client";
import { getAllBlogPosts } from "../../lib/blog";
import { getDictionary, hasLocale, locales } from "../../lib/content";

type LangParams = Promise<{ lang: string }>;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function HomePage({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <SiteAppClient
      lang={lang}
      t={getDictionary(lang)}
      initialRoute={{ name: "home" }}
      blogPosts={getAllBlogPosts()}
    />
  );
}
