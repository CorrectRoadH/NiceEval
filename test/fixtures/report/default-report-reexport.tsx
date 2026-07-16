// 等价性测试夹具:原样 re-export 内建默认报告。
// 用它验证裸宿主 ≡ `--report <内建定义>` —— 内建报告是 `niceeval/report/built-in` 的
// 公开默认导出、一份普通 defineReport 产物,没有私有通道
// (docs/feature/reports/library/built-in.md)。
//
// 走包名自引用(真实用户 --report 文件的路子),不是相对路径进 src/ ——
// 报告运行时以预编译产物发布(dist/report/**,见 tsconfig.report-build.json),裸跑走的
// 也是这份产物;relative-import raw src 会是另一份模块实例,宿主上下文(WebContext
// 模块级状态)就认不出,渲染结果会跟裸跑对不上。

export { default } from "niceeval/report/built-in";
