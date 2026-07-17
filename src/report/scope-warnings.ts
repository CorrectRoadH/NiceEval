// ScopeWarnings 的聚合层:把 Scope 警告按「下一步动作」组织成组,web / text 两面共用
// (docs/feature/reports/library/site-components.md「聚合轴是动作,不是发生顺序」)。
// message 是完整叙述的单源,这里只组织、不改写;徽标 / 组头文案按 kind 表登记的模板
// (docs/feature/results/library.md「警告 kind 全集」)经 locale 词典渲染,未登记的 kind
// 回退为单独成组、逐条 message 原样。

import type { ScopeWarning } from "../results/types.ts";
import { gapParts } from "../results/select.ts";
import { localeText, type ReportLocale, type ReportMessageKey } from "./locale.ts";

/** kind 表登记的类别:integrity(选中集合的分母可能不对)组排在 freshness(可能过期)之前。 */
export type WarningCategory = "integrity" | "freshness";

/**
 * 聚合层的宽松形态:kind 表新增 kind 时(如 unreadable-snapshot 先于类型落地)
 * 不假设字段全集,读结构化字段前逐个判形。
 */
interface AnyWarning {
  kind: string;
  message: string;
  command?: string;
  experimentId?: string;
  [key: string]: unknown;
}

export interface ScopeWarningGroup {
  category: WarningCategory;
  /** 实验组为 experimentId;kind 组为登记的组头文案(含条数);未登记 kind 用 kind 原文。 */
  title: string;
  /** 每条警告一枚、与 warnings 同序;未登记徽标模板的成员不出徽标。 */
  badges: readonly { kind: string; text: string }[];
  /** 组内命令去重后恰一条时归组头(复制即推进整组);多条或零条为 null,命令随明细逐条走。 */
  headCommand: string | null;
  /** 原始条目(明细层,message 单源)。 */
  warnings: readonly ScopeWarning[];
}

export interface GroupedScopeWarnings {
  /** 组数 > 1 时的分类计数汇总行;单组为 null(组头即汇总,不另起一行)。 */
  summary: string | null;
  groups: readonly ScopeWarningGroup[];
  /** 警告总条数 ≤ 3 时明细默认展开(web 面 <details> 的 open;阈值是行为契约,无开关)。 */
  detailsOpen: boolean;
}

const CATEGORY: Record<string, WarningCategory> = {
  "partial-coverage": "integrity",
  "unfinished-snapshot": "integrity",
  "unreadable-snapshot": "integrity",
  "stale-snapshot": "freshness",
};

/** 实验作用域且登记了徽标模板的 kind 才进实验组;其余(含未登记 kind)按 kind 聚合。 */
const EXPERIMENT_KINDS = new Set(["partial-coverage", "stale-snapshot", "unfinished-snapshot"]);

function pluralText(
  locale: ReportLocale,
  base: "warnings.summary.experiments" | "warnings.group.unreadableSnapshot" | "warnings.details",
  n: number,
): string {
  return localeText(locale, `${base}.${n === 1 ? "one" : "other"}` as ReportMessageKey, { n });
}

/** 明细折叠块的标签(「N 条原始警告」)。 */
export function warningDetailsLabel(locale: ReportLocale, n: number): string {
  return pluralText(locale, "warnings.details", n);
}

function gapText(locale: ReportLocale, fromIso: string, toIso: string): string {
  const { n, unit } = gapParts(fromIso, toIso);
  return localeText(locale, `warnings.gap.${unit}.${n === 1 ? "one" : "other"}` as ReportMessageKey, { n });
}

function badgeText(w: AnyWarning, locale: ReportLocale): string | null {
  switch (w.kind) {
    case "partial-coverage":
      return localeText(locale, "warnings.badge.partialCoverage", {
        covered: String(w.covered),
        total: String(w.total),
      });
    case "stale-snapshot":
      return localeText(locale, "warnings.badge.staleSnapshot", {
        gap: gapText(locale, String(w.startedAt), String(w.latestStartedAt)),
      });
    case "unfinished-snapshot":
      return localeText(locale, "warnings.badge.unfinishedSnapshot");
    default:
      return null;
  }
}

/** 组内命令去重:恰一条时它就是「复制即推进整组」的组头命令。 */
function dedupeCommand(members: readonly AnyWarning[]): string | null {
  const commands = new Set(members.map((w) => w.command).filter((c): c is string => typeof c === "string" && c !== ""));
  return commands.size === 1 ? [...commands][0] : null;
}

function groupCategory(members: readonly AnyWarning[]): WarningCategory {
  return members.some((w) => (CATEGORY[w.kind] ?? "integrity") === "integrity") ? "integrity" : "freshness";
}

export function groupScopeWarnings(input: readonly ScopeWarning[], locale: ReportLocale): GroupedScopeWarnings {
  const warnings = input as readonly AnyWarning[];
  const byExperiment = new Map<string, AnyWarning[]>();
  const byKind = new Map<string, AnyWarning[]>();
  for (const w of warnings) {
    if (EXPERIMENT_KINDS.has(w.kind) && typeof w.experimentId === "string") {
      const members = byExperiment.get(w.experimentId) ?? [];
      members.push(w);
      byExperiment.set(w.experimentId, members);
    } else {
      const members = byKind.get(w.kind) ?? [];
      members.push(w);
      byKind.set(w.kind, members);
    }
  }

  const groups: ScopeWarningGroup[] = [];
  for (const [experimentId, members] of byExperiment) {
    groups.push({
      category: groupCategory(members),
      title: experimentId,
      badges: members
        .map((w) => ({ kind: w.kind, text: badgeText(w, locale) }))
        .filter((b): b is { kind: string; text: string } => b.text !== null),
      headCommand: dedupeCommand(members),
      warnings: members as unknown as ScopeWarning[],
    });
  }
  for (const [kind, members] of byKind) {
    groups.push({
      category: CATEGORY[kind] ?? "integrity",
      title:
        kind === "unreadable-snapshot" ? pluralText(locale, "warnings.group.unreadableSnapshot", members.length) : kind,
      badges: [],
      headCommand: dedupeCommand(members),
      warnings: members as unknown as ScopeWarning[],
    });
  }
  // 稳定排序:integrity 在前,同类别保持首次出现顺序。
  const rank = (c: WarningCategory) => (c === "integrity" ? 0 : 1);
  groups.sort((a, b) => rank(a.category) - rank(b.category));

  let summary: string | null = null;
  if (groups.length > 1) {
    const parts: string[] = [];
    if (byExperiment.size > 0) parts.push(pluralText(locale, "warnings.summary.experiments", byExperiment.size));
    for (const [kind, members] of byKind) {
      parts.push(
        kind === "unreadable-snapshot"
          ? pluralText(locale, "warnings.group.unreadableSnapshot", members.length)
          : `${kind} ×${members.length}`,
      );
    }
    summary = parts.join(" · ");
  }

  return { summary, groups, detailsOpen: warnings.length <= 3 };
}
