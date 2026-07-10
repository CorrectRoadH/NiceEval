// Results Format 的布局与版本知识,规则见 docs/results-format.md。
//
// 按 docs/results-lib.md,这份知识只住在本库:写入面(writer.ts / copy.ts)与
// 读取面(open.ts)共用这里的目录规则与版本判定;src/runner/reporters/artifacts.ts
// 是 writer 的薄壳,view(src/view/data.ts)经 openResults 消费,不自带布局知识。

import type { EvalResult, RunSummary } from "../types.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../types.ts";
import type { ArtifactKind } from "./types.ts";

/** attempt 工件子目录(相对 run 根):<evalId>/<agent>/<model>[/<experimentId>]/a<attempt>。 */
export function attemptDirOf(r: Pick<EvalResult, "id" | "agent" | "model" | "attempt" | "experimentId">): string {
  const safe = (s: string) => s.replace(/[^\w.@-]/g, "_");
  // evalId 里的 / 保留作目录层级,其余危险字符替换。
  const id = r.id.replace(/[^\w./@-]/g, "_");
  // experiment 段:两个实验可以同 agent 同 model、只差实验参数,少这一段它们的工件会互相
  // 覆盖;experimentId 里的 / 不作层级(整段压成 _),整个实验一格。
  const exp = r.experimentId ? `/${safe(r.experimentId)}` : "";
  return `${id}/${safe(r.agent)}/${safe(r.model ?? "default")}${exp}/a${r.attempt}`;
}

/** 工件文件名:种类即文件名。 */
export function artifactFileOf(kind: ArtifactKind): string {
  return `${kind}.json`;
}

/** summary.json 的版本判定结果;openResults 按它分流 ok / skipped / 静默忽略。 */
export type SummaryClassification =
  | { kind: "ok"; summary: RunSummary }
  | { kind: "incompatible"; schemaVersion: number; producer?: RunSummary["producer"] }
  | { kind: "malformed"; detail: string }
  | { kind: "not-a-report" };

/**
 * 版本判定与最小形状校验(docs/results-format.md「版本不匹配时的读取行为」):
 * - 带 format 信封:format 不是 niceeval.results → 无关 JSON;schemaVersion 与当前不同 →
 *   不兼容(不解析、不迁移、不降级),缺 schemaVersion 的早期信封按 1 处理。
 * - 无信封:results[] 与 startedAt 同时具备才按 legacy 照读(未知字段忽略);
 *   只沾到一个键的多半是别家工具的 summary.json,按规范当无关 JSON 忽略,不进 skipped 制造噪音。
 */
export function classifySummary(raw: unknown): SummaryClassification {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "malformed", detail: "not a JSON object" };
  }
  const data = raw as Partial<RunSummary>;
  if (data.format !== undefined && data.format !== RESULTS_FORMAT) return { kind: "not-a-report" };
  if (data.format === RESULTS_FORMAT) {
    const version = data.schemaVersion ?? 1;
    if (typeof version !== "number") return { kind: "malformed", detail: "schemaVersion is not a number" };
    if (version !== RESULTS_SCHEMA_VERSION) {
      // skipped 必须带完整 producer(name + version):npx 提示只对 name === "niceeval" 成立,
      // 第三方 harness 的落盘只给裸版本号的话,消费方连做对这个分支的信息都没有。
      return { kind: "incompatible", schemaVersion: version, producer: data.producer };
    }
    if (!Array.isArray(data.results) || typeof data.startedAt !== "string") {
      return { kind: "malformed", detail: "missing results[] or startedAt" };
    }
    return { kind: "ok", summary: data as RunSummary };
  }
  if (!Array.isArray(data.results) || typeof data.startedAt !== "string") {
    return { kind: "not-a-report" };
  }
  return { kind: "ok", summary: data as RunSummary };
}

/**
 * 快照/去重共用的 experiment 身份键:experimentId 缺失时以 "<agent>/<model>" 合成
 * (无 model 用 "default",与工件目录命名同一口径),synthesized 供调用方决定要不要出 warning。
 */
export function experimentKeyOf(r: Pick<EvalResult, "experimentId" | "agent" | "model">): {
  id: string;
  synthesized: boolean;
} {
  if (r.experimentId) return { id: r.experimentId, synthesized: false };
  return { id: `${r.agent}/${r.model ?? "default"}`, synthesized: true };
}
