import { notFound } from "next/navigation";
import SiteAppClient from "../../../components/site-app-client";
import { getAllBlogPosts } from "../../../lib/blog";
import { getDictionary, hasLocale, locales } from "../../../lib/content";

type LangParams = Promise<{ lang: string }>;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return {
    title: "Blog",
    description: t.blogPage.meta,
  };
}

export default async function BlogIndexPage({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <SiteAppClient
      lang={lang}
      t={getDictionary(lang)}
      initialRoute={{ name: "blog" }}
      blogPosts={getAllBlogPosts()}
    />
  );
}
