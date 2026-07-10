// 全序日志:每个钩子 / agent 生命周期方法调用一次,追加一行 JSON 到夹具目录下的
// 日志文件。测试跑完 CLI 后读回这个文件,断言事件顺序与 experimentId。
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

const LOG_PATH = join(process.cwd(), ".hook-log.jsonl");

export async function logEvent(event: string, experimentId?: string): Promise<void> {
  await appendFile(LOG_PATH, `${JSON.stringify({ event, experimentId })}\n`);
}
