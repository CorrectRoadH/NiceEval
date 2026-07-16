// niceeval/report/built-in —— 包里自带的一个报告文件,没有任何私有钩子
// (docs/feature/reports/library/built-in.md)。裸 `niceeval show` 与 `niceeval view`
// 装载的就是这份默认导出:一份普通 defineReport,与用户的 --report 文件同层、
// 走同一条 装载 → resolve → validate → render 管线。「builtin」不是装载逻辑里的类别,
// 只是宿主默认拿哪个值的事实。

import { ExperimentComparison, defineReport } from "../index.ts";

export default defineReport(<ExperimentComparison />);
