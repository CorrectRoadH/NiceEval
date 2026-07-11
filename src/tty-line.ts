// 独立诊断行的统一终端出口。
//
// live 表格(src/runner/reporters/live.ts)重画靠 \x1B[{drawnLines}A 回跳到上一帧起点,
// 这个回跳量的前提是"stderr/stdout 这块屏幕在两帧之间只有它自己在写"。sandbox teardown
// 失败、budget 不可执行、reporter 抛错这类跟 attempt 进度无关的独立诊断行,如果在 live
// 表格激活期间直接 process.stderr.write / console.log,就会插进两次 draw() 之间——下一帧
// 按旧的 drawnLines 回跳,已经够不到表格真正的起点,清行重画变成往下多写一份,且这个偏移
// 被记进新的 drawnLines,此后每帧都在错位的基础上继续错位,越滚越多(见
// memory/live-raw-stderr-write-desyncs-redraw.md)。
//
// 所以任何不经过 Reporter.progress() / onEvalComplete() 的独立诊断行,写之前都要先广播
// beforeExternalTerminalWrite(),live.ts 借此机会把已画内容清掉、drawnLines 归零,下一次
// draw() 就会把这行诊断消息之下当成全新起点重画,不会累积。

const listeners = new Set<() => void>();

/** live.ts 用来订阅"即将有一行独立诊断消息落地"。返回取消订阅函数。 */
export function onBeforeExternalTerminalWrite(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 任何要绕开 Reporter 直接往终端打一行独立诊断消息的地方,写之前都先调用这个。 */
export function beforeExternalTerminalWrite(): void {
  for (const fn of listeners) fn();
}

/** process.stderr.write 的替代:文本需自带换行(沿用现有 i18n 字符串的约定)。 */
export function writeStderrLine(text: string): void {
  beforeExternalTerminalWrite();
  process.stderr.write(text);
}
