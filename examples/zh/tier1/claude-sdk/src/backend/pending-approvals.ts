// 进程级、内存态的"待审批"表 —— HITL(human-in-the-loop)审批的唯一状态存储。
//
// 写入方只有一处:agent.ts 里的 canUseTool,遇到需要审批的工具调用时把
// resolver 存进来,然后 await 一个 Promise<boolean>。server.ts 的
// POST /api/chat/approve 路由是唯一的读取/消费方:按 toolUseId 找到 resolver、
// 调用它、删掉这条记录。
//
// 之所以单独拆一个文件而不是塞进 server.ts 或 agent.ts:agent.ts 需要写入、
// server.ts 需要读取,两者互相 import 对方会成环;独立模块让依赖方向清晰。
//
// 注意:ui-stream.ts(把 SDKMessage 流翻译成 UIMessageChunk 的适配器)不碰
// 这张表——它只是原样转发 query() 自然产出的消息(包括 canUseTool 拒绝时
// SDK 发出的 system/permission_denied 消息)。如果 ui-stream.ts 也对同一个
// toolUseId 调 pendingApprovals.set(...),会把 canUseTool 里刚设的 resolver
// 覆盖掉,导致 canUseTool 的 Promise 永远 resolve 不了——所以这张表全程只有
// 一个写入方。
export const pendingApprovals = new Map<string, (approved: boolean) => void>();
