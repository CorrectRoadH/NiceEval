# live 面板 ACTIVE 行:宽终端下右侧被框截断,phase/detail 完全不可见

## 现象

宽终端(>100 列,如全屏 iTerm ~250 列)跑 `niceeval exp`,live 面板 ACTIVE 行只显示 eval id + 一大段空白 + `canar…`(who 列开头几个字符),elapsed 与 phase/detail(attempt 实际在干什么)整段消失在框外:

```
│ ● install/gpt-researcher                                                                  canar… │
```

正是注释里写的「phase/detail 才是 active 行存在的理由」那部分看不见了。2026-07-23 用户在 NiceEval-Eval 真机复现。

## 根因

行内容与外框各自按不同宽度计算,契约不匹配:

- `src/runner/feedback/human.ts` `buildFrameLines()`(约 L438)手写 `contentWidth = capability.width - 4`,其中 `capability.width` = 终端裸列数(如 246)——**没有过 `MAX_BOX_WIDTH` 钳制**。
- `formatActiveRow()` 按这个大宽度排版:detailReserve 封顶 80,identity 区(evalCol+whoCol)按剩余 65% 比例分到 ~150 列,who 列从约第 88 列才开始。
- `src/report/model/panel.ts` `renderPanel()` 把框钳到 `MAX_BOX_WIDTH = 100`,每行内容按 96 列截断补 `…`——who 列只剩开头几个字符,elapsed/detail 全部被切掉。

panel.ts 导出的 `panelContentWidth(width, mode)` 正是为调用方算「钳制后内容宽」而存在(注释:「同一个 width 参数——嵌套不吞可用宽度」),human.ts 没用它、自己减 4,漏掉钳制。终端 ≤100 列时两个算法一致,所以窄终端(含单测的 fake io)看不出问题——这也是它逃过测试的原因。

## 修法(已裁决,待落地)

设计裁决见 [live-dashboard-full-width-ruling](live-dashboard-full-width-ruling.md)(live 面板全宽 + 内容定宽列),实现 TODO 在 `plan/live-dashboard-full-width-detail.md`。原始分析的两层:

1. **接线修正**(一行):`buildFrameLines()` 的 `contentWidth` 改用 `panelContentWidth(capability.width, capability.mode)`。修完宽终端与 100 列终端行为一致。
2. **列宽设计仍待改**(修完 1 也只是不再消失,不代表好用):96 列内 detail 预算 = 96 − 前缀 63 = 33 列,再扣 `phaseLabel: ` 前缀,实际可见输出 ~20 列,仍然太短;且比例分配把短 id 垫空格(eval 22 字符垫到 27、who 6 字符垫到 22),空白全是 detail 本可用的宽度。方向:identity 列按**当前可见行的实际最长值**定宽(帧内稳定、设上限),剩余全部给 detail;或再议 ACTIVE 面板是否解除 `MAX_BOX_WIDTH=100`(宽终端本来有地方)。列宽设计变更走设计流程,别在修 1 时顺手拍。

回归校验:fake io 用 `columns: 200` 复现(现有单测都是窄终端所以没拦住);断言 ACTIVE 行的 detail 文本出现在渲染结果里。
