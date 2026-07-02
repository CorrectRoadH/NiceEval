// shell 拼接工具:单引号转义与 find 脚本构造,docker / vercel / e2b / checkpoint 共用。

/** 单引号包裹 + 转义,把一个参数安全嵌进 shell 命令串。 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * 构造 readSourceFiles 用的 find 脚本:按目录名(任意深度)剪枝、按扩展名收文件,
 * 输出 `./` 前缀的相对路径。ignoreDirs / extensions 可能来自 eval 作者输入,
 * 一律走 shellQuote 转义后再拼进脚本,防止特殊字符破坏脚本结构。
 */
export function buildFindScript(opts: { extensions: readonly string[]; ignoreDirs: readonly string[] }): string {
  const dirPrune = opts.ignoreDirs.map((d) => `-name ${shellQuote(d)}`).join(" -o ");
  const nameTests = opts.extensions.map((e) => `-name ${shellQuote(`*.${e}`)}`).join(" -o ");
  return `find . \\( -type d \\( ${dirPrune} \\) \\) -prune -o -type f \\( ${nameTests} \\) -print`;
}
