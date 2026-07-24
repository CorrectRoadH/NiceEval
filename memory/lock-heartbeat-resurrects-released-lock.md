# 心跳续租在飞时释放锁,锁文件会被写回复活

## 现象

跑完的用例已经调过 `claim.release()`(删掉了锁文件),`.niceeval/locks/` 里那条锁却又出现了。
最小复现(40 次里复活 39 次):

```ts
const { claim } = await acquireCaseLock(root, "e", "v", { pid: 1, host: "h" }, { heartbeatIntervalMs: 1 });
await sleep(5);            // 让某次心跳正在飞
await claim.release();
await sleep(20);
await readdir(locksDirOf(root)); // → 锁文件还在
```

在单测里表现为间歇 flaky:`run.test.ts` 的「撞新鲜锁的用例不派发……」末尾
`expect(await lockFilesRemaining(root)).toEqual([])` 偶尔拿到一条已经跑完的 eval 的锁
(该用例用假时钟一次推 40s,正好让若干次心跳落进另一条 eval 的释放窗口)。全量 `pnpm test`
负载高时更容易命中,单跑该文件几乎不复现。

真实后果:一次运行结束后磁盘上留下一把「新鲜」的锁,下一条 Invocation 撞上它要白等到心跳
过期(30s)才接管——与契约「整批结束后 `.niceeval/locks/` 为空」相悖。

## 根因

`src/runner/lock.ts` 的心跳回调是一段「读—改—写」:

```ts
const current = await readEntryFile<CaseLockRecord>(dir, id);
if (current === undefined) return;
await writeEntryFile(dir, id, { ...current, heartbeatAt: ... });   // ← 这中间锁可能已经被释放
```

`release()` 只做 `clearInterval(timer)` + `rm()`。`clearInterval` 拦不住**已经进入回调、正卡在
`readEntryFile` 的那一次**心跳:它读到的记录还在,等它 `writeEntryFile`(tmp → rename)时锁文件
已经被 `rm` 掉了,于是原路径被重新创建出来。心跳周期越短、释放与心跳越同步(假时钟一次推进
多个周期就是极端情形),命中概率越高。

`src/runner/gate-lease.ts` 的 `renewHeartbeat` 是同一套形状(多一道 `isSameHolder` 判别,但那只
防「槽被别人接管」,不防「自己刚释放」),同一条竞态成立。

## 修法(未修)

释放标志要参与心跳的写回判断,而不是只指望 `clearInterval`:心跳回调在**写回之前**再确认一次
自己还没被释放。落点是 `lock.ts` 的 `acquireCaseLock`(把 `released` 传进 `renewHeartbeat`,或把
读—写两步搬进 `acquireCaseLock` 内联闭包)与 `gate-lease.ts` 的同名函数——两处一起改,别只修一边。
`release()` 里 `rm` 之后再补一次删除也能兜住,但那是治标:写回本身就不该发生。

发现于 plan/runner-dispatch-spine-refactor.md 节点 C1(派发时刻取锁)实现期。取锁时机从计划期
挪到派发时刻之后,单条用例的持锁窗口更短、更容易与假时钟推进的心跳重叠,这条一直存在的竞态
才浮出来——它不是 C1 引入的。
