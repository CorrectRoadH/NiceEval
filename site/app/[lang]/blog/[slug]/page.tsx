import { notFound } from "next/navigation";
import SiteAppClient from "../../../../components/site-app-client";
import { getAllBlogPosts, getBlogPostBySlug } from "../../../../lib/blog";
import { getDictionary, hasLocale, locales } from "../../../../lib/content";

type BlogPostParams = Promise<{ lang: string; slug: string }>;

export function generateStaticParams() {
  return locales.flatMap((lang) => getAllBlogPosts().map((post) => ({ lang, slug: post.slug })));
}

export async function generateMetadata({ params }: { params: BlogPostParams }) {
  const { lang, slug } = await params;
  if (!hasLocale(lang)) return {};

  const post = getBlogPostBySlug(slug);
  if (!post) {
    return { title: "Post not found" };
  }

  const postCopy = post[lang];
  return {
    title: postCopy.title,
    description: postCopy.description,
  };
}

export default async function BlogPostPage({ params }: { params: BlogPostParams }) {
  const { lang, slug } = await params;
  if (!hasLocale(lang)) notFound();

  const post = getBlogPostBySlug(slug);
  if (!post) notFound();

  return (
    <SiteAppClient
      lang={lang}
      t={getDictionary(lang)}
      initialRoute={{ name: "post", slug }}
      blogPosts={getAllBlogPosts()}
    />
  );
}
