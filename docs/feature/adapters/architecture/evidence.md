# 断言证据与完整性

作用域断言只消费 `Turn`、标准事件及其派生事实。Adapter 不实现断言，但其数据来源决定结论能否成立。

| 证据 | 支撑的结论 | 缺失风险 |
|---|---|---|
| 真实 Turn status | succeeded、parked | 恒 completed 会静默假通过 |
| assistant message | reply、messageIncludes | 正断言失败 |
| Turn data | output 断言 | 正断言失败 |
| 完整 action 生命周期 | 工具正负断言、顺序、失败 | 负断言可能假通过 |
| skill.loaded | loadedSkill | 正断言失败 |
| 完整事件流 | event / notEvent / order | notEvent 可能假通过 |
| usage | token/cost 上限 | 缺失按零聚合，可能假通过 |

## 完整性不变量

正断言在数据缺失时通常失败；负断言与上限断言在空流或半空流上可能成立。因此漏掉部分事件比完全没有事件更危险。

官方 SDK 完整事件流、完整 steps/output 和经过生命周期 fixture 验证的 transcript 可以形成完整性证据。最终自然语言、只采成功事件的埋点、内容可脱敏的 OTel span，以及未覆盖并发/失败的手写映射不能单独证明完整。

Adapter 无法完整采集时必须说明哪些负断言不可信，不能用空数组表达“确认没有发生”。OTel 始终属于时间轨，不补写行为事件。

## 状态不变量

Turn completed 表示一轮正常结束，不表示每个工具成功；Turn failed 表示本轮运行失败；waiting 表示停在结构化输入请求。Action rejected 是人或策略拒绝，不能计作工具故障。
