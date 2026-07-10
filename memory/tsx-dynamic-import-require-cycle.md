# tsx 动态 import 用户 .ts 在 CJS 目录下报 ERR_REQUIRE_CYCLE_MODULE

**现象**:CLI 经 tsx 动态 `import()` 用户项目里的 `.ts` 文件(`niceeval.config.ts`、`--report` 的报告文件)时,若该文件所在目录的 `package.json` 没有 `"type": "module"`,Node 报 `ERR_REQUIRE_CYCLE_MODULE` 直接失败。`loadConfig` 与 `src/show/index.ts` 的 `loadReportFile` 共享同一 tsx 装载机制,两处都会踩。2026-07 实现 `niceeval show --report` 时发现(既有环境事实,非该次引入)。

**根因**:无 `"type": "module"` 时 Node 把 `.ts`(经 tsx 钩子)按 CJS 语义解析,tsx 的 ESM/CJS 桥在循环引用检测上抛错;文件本身没有循环,是解析模式错配。

**修法**:尚未修。绕过方式是用户项目 `package.json` 声明 `"type": "module"`(examples/zh 全部如此,所以日常没暴露)。若要根治,候选方向是装载失败时识别该错误码并给出直说的提示(加 `"type": "module"` 或改扩展名 `.mts`),落点 `loadConfig` 与 `loadReportFile` 共用的装载路径。
