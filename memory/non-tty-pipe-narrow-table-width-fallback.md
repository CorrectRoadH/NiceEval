# 非 TTY 管道下 show 表格窄折行是宽度回退,不是渲染缺陷

- **现象**:`node bin/niceeval.js show ... | head` 或任何纯管道(无 TTY)下,榜单/对照矩阵/用量表逐字符窄折行,和 docs 宽表示例完全不像,极易误判为渲染 bug。
- **根因**:表格宽度读 `process.stdout.columns`,非 TTY 管道下为 `undefined`,走窄回退。
- **修法**:走查/e2e/截样例时用 `script -q /dev/null bash -c 'stty cols 200; node bin/niceeval.js show ...'` 给出宽度;或直接在真终端跑。X1 走查与 F2 教程取样都用的这个办法。
- **适用场景**:任何要把 show text 面输出与 docs 示例做形态比对的场合,先排除宽度回退再谈渲染问题。
