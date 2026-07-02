// 把裸 SourceFile[] 包装成带便利方法的 SourceFiles(仍是真数组),
// 以及 vercel / e2b 共用的「find 列文件 + 逐文件读」两阶段读取模板。
// 方法用 defineProperties 挂成 non-enumerable:.filter/.map/展开/迭代/JSON 都不受影响。

import type { CommandResult, ReadSourceFilesOptions, SourceFile, SourceFiles } from "../types.ts";
import { stripComments } from "../util.ts";
import { buildFindScript } from "./shell.ts";
import { DEFAULT_IGNORE_DIRS, DEFAULT_IGNORE_FILES, DEFAULT_SOURCE_EXTENSIONS } from "./local-files.ts";

export function makeSourceFiles(files: SourceFile[]): SourceFiles {
  const arr = files.slice();
  const text = (): string => arr.map((f) => `\n// ${f.path}\n${f.content}`).join("\n");

  Object.defineProperties(arr, {
    text: { value: text, enumerable: false },
    code: { value: (): string => stripComments(text()), enumerable: false },
    fileMatching: {
      value: (pattern: RegExp): SourceFile | undefined => arr.find((f) => pattern.test(f.content)),
      enumerable: false,
    },
    fileMatchingAll: {
      value: (patterns: RegExp[]): SourceFile | undefined =>
        arr.find((f) => patterns.every((p) => p.test(f.content))),
      enumerable: false,
    },
    hasPath: {
      value: (pattern: RegExp): boolean => arr.some((f) => pattern.test(f.path)),
      enumerable: false,
    },
  });

  return arr as unknown as SourceFiles;
}

/**
 * 两阶段 readSourceFiles 模板(vercel / e2b 共用):
 * Phase 1 只做 find(列路径,短命令快速结束);Phase 2 经 readOne 逐文件独立读取,
 * 不依赖长命令输出流 —— 即使 session 快到平台上限,后半段读取也不会被截断。
 * readOne 返回 null 表示该文件跳过(二进制、无权限等)。
 */
export async function readSourceFilesByList(opts: {
  options: ReadSourceFilesOptions;
  runShell: (script: string) => Promise<CommandResult>;
  readOne: (path: string) => Promise<string | null>;
}): Promise<SourceFiles> {
  const extensions = opts.options.extensions ?? DEFAULT_SOURCE_EXTENSIONS;
  const ignoreDirs = opts.options.ignoreDirs ?? DEFAULT_IGNORE_DIRS;
  const ignoreFiles = new Set(opts.options.ignoreFiles ?? DEFAULT_IGNORE_FILES);

  const result = await opts.runShell(buildFindScript({ extensions, ignoreDirs }));

  const paths = result.stdout
    .trim()
    .split("\n")
    .map((p) => p.trim().replace(/^\.\//, ""))
    .filter((p) => p && !ignoreFiles.has(p.split("/").at(-1) ?? ""));

  const files: SourceFile[] = [];
  await Promise.all(
    paths.map(async (path) => {
      try {
        const content = await opts.readOne(path);
        if (content !== null) files.push({ path, content });
      } catch {
        // 跳过读不了的文件(二进制、权限等)。
      }
    }),
  );
  return makeSourceFiles(files);
}
