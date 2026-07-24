#!/usr/bin/env node
// niceeval 入口:注册 tsx 的 ESM + CJS 两个 loader hook(让我们能直接 import 用户的 .ts:
// niceeval.config.ts、evals/*.eval.ts、agents/*.ts),再加载真正的 CLI。
// 两个 hook 缺一不可:tsx 按离文件最近的 package.json 的 type 决定把用户 .ts 编成 ESM 还是
// CJS,宿主项目是 CJS 形态(npm init -y 默认)时用户文件落进 Node 的 CJS loader,只注册 ESM
// hook 就没人转译(见 docs/cli.md「装载用户 .ts」)。
// 这样框架与被测项目都不需要编译步骤,也不挑宿主的模块形态。
import { fileURLToPath } from "node:url";
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

const cliUrl = new URL("../src/cli.ts", import.meta.url);
await import(fileURLToPath(cliUrl));
