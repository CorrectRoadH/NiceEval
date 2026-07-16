// 包外用户报告的等价副本:一个普通用户会写的 --report 文件,只从 niceeval/report 的公开
// barrel(这里按测试约定用相对源码路径 src/report/index.ts)import 积木,零内部路径、
// 零数据装配。它与内建报告(niceeval/report/built-in 的默认导出)逐字同构:
// `export default defineReport(<ExperimentComparison />)` —— 证明「内建报告就是普通用户报告」。

import { ExperimentComparison, defineReport } from "../../../src/report/index.ts";

export default defineReport(<ExperimentComparison />);
