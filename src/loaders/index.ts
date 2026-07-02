// 数据集加载器:把 YAML / JSON 读进来,配 .map(row => defineEval(...)) 扇出。

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadJson<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(resolve(process.cwd(), path), "utf-8");
  return JSON.parse(raw) as T;
}

export async function loadYaml<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(resolve(process.cwd(), path), "utf-8");
  // yaml 是可选依赖:用变量 specifier 避免 tsc 静态解析。装了就用真解析器;
  // 没装直接报错并给出下一步 —— 不再退回手写的「极简 YAML」:它对嵌套 / 多行 /
  // 锚点会静默解析出错误数据,让 eval 拿着错的 case 跑起来比直接失败更糟。
  const yamlPkg = "yaml";
  let parse: (s: string) => unknown;
  try {
    ({ parse } = (await import(yamlPkg)) as { parse(s: string): unknown });
  } catch {
    throw new Error(
      `loadYaml("${path}") 需要 yaml 解析器:请先 \`pnpm add yaml\`(或改用 loadJson + JSON 数据集)。`,
    );
  }
  return parse(raw) as T;
}
