import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const postsDir = path.join(process.cwd(), "src/blog/posts");
const requiredFrontmatter = ["title", "description", "date", "category", "readMinutes"] as const;

export type BlogPostCopy = {
  title: string;
  description: string;
  date: string;
  category: string;
  readMinutes: string;
  status: string;
  body: string;
};

export type BlogPost = {
  slug: string;
  en: BlogPostCopy;
  zh: BlogPostCopy;
};

function parseMdxDocument(source: string): BlogPostCopy {
  const frontmatterMatch = source.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter: Record<string, string> = {};
  let body = source;

  if (frontmatterMatch) {
    body = source.slice(frontmatterMatch[0].length);
    for (const line of frontmatterMatch[1].split("\n")) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      frontmatter[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }

  for (const key of requiredFrontmatter) {
    if (!frontmatter[key]) {
      throw new Error(`Blog post is missing required frontmatter: ${key}`);
    }
  }

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    date: frontmatter.date,
    category: frontmatter.category,
    readMinutes: frontmatter.readMinutes,
    status: frontmatter.status ?? "published",
    body: body.trim(),
  };
}

function readPost(slug: string, locale: "en" | "zh") {
  const postPath = `${postsDir}/${slug}/${locale}.mdx`;
  return parseMdxDocument(readFileSync(postPath, "utf8"));
}

export function getAllBlogPosts(): BlogPost[] {
  return readdirSync(postsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      slug: entry.name,
      en: readPost(entry.name, "en"),
      zh: readPost(entry.name, "zh"),
    }))
    .filter((post) => post.en.status !== "draft" && post.zh.status !== "draft")
    .sort((a, b) => b.en.date.localeCompare(a.en.date));
}

export function getBlogPostBySlug(slug: string) {
  return getAllBlogPosts().find((post) => post.slug === slug) ?? null;
}
