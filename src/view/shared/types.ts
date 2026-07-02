// server(aggregate/loader)与前端(app/)共用的 view 数据形状。
// viewData 会被序列化进静态 HTML,两边必须对同一份声明编程;只允许 type import。

import type { EvalResult, LocalizedText, Usage } from "../../types.ts";

/** 榜单一行 = 一个实验(或 legacy 的 agent×model 组合),跨全部历史 run 聚合。 */
export interface ViewRow {
  key: string;
  experimentId?: string;
  experiment?: EvalResult["experiment"];
  group?: string;
  label: string;
  agent: string;
  model?: string;
  /** 总 attempt 数(详情里作次要信息)。 */
  runs: number;
  /** 去重后的 eval 数(成功率分母的口径)。 */
  evals: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  scored?: number;
  passRate: number;
  avgDurationMs: number;
  usage: Usage;
  estimatedCostUSD?: number;
  /** 该实验组里最新一次 run 的 startedAt(ISO);详情展示「运行时间」。 */
  lastRunAt?: string;
  results: EvalResult[];
}

/** 目录扫描里被跳过的 run 在页面顶部的提示条目。 */
export interface SkippedRunNotice {
  /** run 目录(summary.json 所在目录),相对 cwd。 */
  dir: string;
  reason: "incompatible-version" | "malformed";
  schemaVersion?: number;
  producerVersion?: string;
  /** incompatible-version:服务端拼好的查看命令(npx niceeval@<version> view <dir>)。 */
  command?: string;
  /** malformed:一句诊断(invalid JSON / results 不是数组 …)。 */
  detail?: string;
}

/**
 * 烘焙进 HTML 的页面数据。时间/比率/成本一律传原始值(ISO 字符串、number),
 * 格式化统一由前端按当前界面 locale 做,server 不预格式化。
 */
export interface ViewData {
  rows?: ViewRow[];
  /** 项目名(来自 config.name);hero 标题,可按 locale 多语言。 */
  name?: LocalizedText;
  /** 最近一次 run 的 startedAt(ISO);没有历史 run 时缺省。 */
  lastRunAt?: string;
  /** 0–1 的通过率。 */
  passRate: number;
  /** 去重后的 eval 结果数。 */
  resultCount: number;
  durationMs: number;
  estimatedCostUSD?: number;
  /** 读不了 / 版本不同而被跳过的 run;前端顶部横幅展示。 */
  skippedRuns?: SkippedRunNotice[];
}
