// 把裸 SourceFile[] 包装成带便利方法的 SourceFiles(仍是真数组)。
// 方法用 defineProperties 挂成 non-enumerable:.filter/.map/展开/迭代/JSON 都不受影响。

import type { SourceFile, SourceFiles } from "../types.ts";
import { stripComments } from "../util.ts";

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
