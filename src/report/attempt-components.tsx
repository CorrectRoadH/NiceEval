// Attempt 详情组件族的装配点(docs/feature/reports/library/attempt-detail.md)。11 个叶子
// 组件都是同一份 spec/data 判别联合(AttemptSectionProps<Data>):省略 input 时取当前
// attempt-input page 注入的 evidence;放在 scope-input page 且未显式传 input/data 时
// resolve 报完整用户反馈并指引移到 attempt-input page 或传入 evidence。
// AttemptAssessment / AttemptDetail 是组合组件,只装配叶子,不产生新的 data 或渲染面。

import type { ReactNode } from "react";
import { defineComponent, type ReportComponent, type ResolveContext, type TextContext, type WebContext } from "./tree.ts";
import { Col } from "./primitives.tsx";
import type { AttemptEvidence } from "../results/attempt-evidence.ts";
import type {
  AttemptAssertionsData,
  AttemptConversationData,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptSourceData,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  AttemptUsageData,
} from "./types.ts";
import {
  attemptAssertionsData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSourceData,
  attemptSummaryData,
  attemptTimelineData,
  attemptTraceData,
  attemptUsageData,
} from "./attempt-compute.ts";
import {
  attemptAssertionsText,
  attemptConversationText,
  attemptDiagnosticsText,
  attemptDiffText,
  attemptErrorText,
  attemptFixPromptText,
  attemptSourceText,
  attemptSummaryText,
  attemptTimelineText,
  attemptTraceText,
  attemptUsageText,
} from "./text/attempt-faces.ts";
import { AttemptSummary as AttemptSummaryWeb } from "./react/AttemptSummary.tsx";
import { AttemptError as AttemptErrorWeb } from "./react/AttemptError.tsx";
import { AttemptAssertions as AttemptAssertionsWeb } from "./react/AttemptAssertions.tsx";
import { AttemptSource as AttemptSourceWeb } from "./react/AttemptSource.tsx";
import { AttemptFixPrompt as AttemptFixPromptWeb } from "./react/AttemptFixPrompt.tsx";
import { AttemptTimeline as AttemptTimelineWeb } from "./react/AttemptTimeline.tsx";
import { AttemptConversation as AttemptConversationWeb } from "./react/AttemptConversation.tsx";
import { AttemptDiagnostics as AttemptDiagnosticsWeb } from "./react/AttemptDiagnostics.tsx";
import { AttemptUsage as AttemptUsageWeb } from "./react/AttemptUsage.tsx";
import { AttemptTrace as AttemptTraceWeb } from "./react/AttemptTrace.tsx";
import { AttemptDiff as AttemptDiffWeb } from "./react/AttemptDiff.tsx";

// ───────────────────────── spec / data 判别联合 ─────────────────────────

export type AttemptSectionProps<Data> =
  | { input?: AttemptEvidence; data?: never; className?: string }
  | { data: Data; input?: never; className?: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attemptDataShapeError(component: string, dataFnName: string, shape: string, problem: string): Error {
  return new Error(
    `<${component}> received data that does not match the current ${shape} shape: ${problem}. ` +
      `It may have been computed by a different niceeval version (component data carries no schemaVersion; the support window is same-version write and read). ` +
      `Recompute it with ${dataFnName}() from this niceeval version, then re-render.`,
  );
}

interface AttemptComponentDef<Data> {
  name: string;
  dataFnName: string;
  shapeName: string;
  dataFn: (evidence: AttemptEvidence) => Data | null;
  /** 只在 data !== null 时调用。 */
  validate: (data: unknown) => string | null;
  web(props: { data: Data | null; className?: string }, ctx: WebContext): ReactNode;
  text(props: { data: Data | null; className?: string }, ctx: TextContext): string;
}

/**
 * 11 个叶子组件共用的装配:resolve 决定 evidence 来源(显式 data > 显式 input > 当前
 * attempt-input page 注入的 evidence),不在 scope-input page 上凭空工作;两面渲染前都
 * 校验 data 结构,版本漂移时报完整用户反馈而不是静默展示错误字段。
 */
function makeAttemptComponent<Data>(
  def: AttemptComponentDef<Data>,
): ReportComponent<AttemptSectionProps<Data>> {
  type Props = Record<string, unknown>;
  type Resolved = { data: Data | null; className?: string };

  const assertData = (data: unknown): Data | null => {
    if (data === null) return null;
    const problem = def.validate(data);
    if (problem !== null) throw attemptDataShapeError(def.name, def.dataFnName, def.shapeName, problem);
    return data as Data;
  };

  const resolve = (props: Props, ctx: ResolveContext): Resolved => {
    if (props.data !== undefined) {
      if (props.input !== undefined) {
        throw new Error(
          `<${def.name}> got both \`data\` and \`input\` — the two evidence sources are exclusive and niceeval will not silently pick one. ` +
            `Keep \`data\` (precomputed with ${def.dataFnName}()) and drop \`input\`, or drop \`data\` and let the pipeline compute it from the evidence.`,
        );
      }
      assertData(props.data);
      return { data: props.data as Data, className: props.className as string | undefined };
    }
    const evidence =
      (props.input as AttemptEvidence | undefined) ?? (ctx.page.input === "attempt" ? ctx.page.evidence : undefined);
    if (evidence === undefined) {
      throw new Error(
        `<${def.name}> needs an attempt: the current page has no locator to derive evidence from (it is a scope-input page, or no page context is active). ` +
          `Move it to an attempt-input page (\`input: "attempt"\`), or pass \`input\` explicitly with an AttemptEvidence.`,
      );
    }
    return { data: def.dataFn(evidence), className: props.className as string | undefined };
  };

  const component = defineComponent<Props, Resolved>({
    resolve,
    web: (props, ctx) => {
      assertData(props.data);
      return def.web(props, ctx);
    },
    text: (props, ctx) => {
      assertData(props.data);
      return def.text(props, ctx);
    },
  }) as unknown as ReportComponent<AttemptSectionProps<Data>>;
  component.displayName = def.name;
  return component;
}

// ───────────────────────── AttemptSummary(恒非空) ─────────────────────────

function validateSummaryData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (typeof data.verdict !== "string") return 'missing "verdict" (string)';
  if (!isObject(data.capabilities)) return 'missing "capabilities" ({ source, execution, timing, diff })';
  return null;
}

export const AttemptSummary = makeAttemptComponent<AttemptSummaryData>({
  name: "AttemptSummary",
  dataFnName: "attemptSummaryData",
  shapeName: "AttemptSummaryData",
  dataFn: attemptSummaryData,
  validate: validateSummaryData,
  web: (props, ctx) => <AttemptSummaryWeb data={props.data as AttemptSummaryData} locale={ctx.locale} className={props.className} />,
  text: (props, ctx) => attemptSummaryText(props.data as AttemptSummaryData, ctx),
});

// ───────────────────────── AttemptError ─────────────────────────

function validateErrorData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.code !== "string" || typeof data.message !== "string") return 'missing "code" / "message" (string)';
  return null;
}

export const AttemptError = makeAttemptComponent<AttemptErrorData>({
  name: "AttemptError",
  dataFnName: "attemptErrorData",
  shapeName: "AttemptErrorData",
  dataFn: attemptErrorData,
  validate: validateErrorData,
  web: (props, ctx) => <AttemptErrorWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptErrorText(props.data, ctx),
});

// ───────────────────────── AttemptAssertions ─────────────────────────

function validateAssertionsData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (!Array.isArray(data.attention)) return 'missing "attention" (array)';
  if (!Array.isArray(data.passedGroups)) return 'missing "passedGroups" (array)';
  return null;
}

export const AttemptAssertions = makeAttemptComponent<AttemptAssertionsData>({
  name: "AttemptAssertions",
  dataFnName: "attemptAssertionsData",
  shapeName: "AttemptAssertionsData",
  dataFn: attemptAssertionsData,
  validate: validateAssertionsData,
  web: (props, ctx) => <AttemptAssertionsWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptAssertionsText(props.data, ctx),
});

// ───────────────────────── AttemptSource ─────────────────────────

function validateSourceData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (typeof data.sourcePath !== "string") return 'missing "sourcePath" (string)';
  if (!Array.isArray(data.lines)) return 'missing "lines" (array)';
  return null;
}

export const AttemptSource = makeAttemptComponent<AttemptSourceData>({
  name: "AttemptSource",
  dataFnName: "attemptSourceData",
  shapeName: "AttemptSourceData",
  dataFn: attemptSourceData,
  validate: validateSourceData,
  web: (props, ctx) => <AttemptSourceWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptSourceText(props.data, ctx),
});

// ───────────────────────── AttemptFixPrompt ─────────────────────────

function validateFixPromptData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.prompt !== "string") return 'missing "prompt" (string)';
  return null;
}

export const AttemptFixPrompt = makeAttemptComponent<AttemptFixPromptData>({
  name: "AttemptFixPrompt",
  dataFnName: "attemptFixPromptData",
  shapeName: "AttemptFixPromptData",
  dataFn: attemptFixPromptData,
  validate: validateFixPromptData,
  web: (props, ctx) => <AttemptFixPromptWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptFixPromptText(props.data, ctx),
});

// ───────────────────────── AttemptTimeline ─────────────────────────

function validateTimelineData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (!Array.isArray(data.phases)) return 'missing "phases" (array)';
  return null;
}

export const AttemptTimeline = makeAttemptComponent<AttemptTimelineData>({
  name: "AttemptTimeline",
  dataFnName: "attemptTimelineData",
  shapeName: "AttemptTimelineData",
  dataFn: attemptTimelineData,
  validate: validateTimelineData,
  web: (props, ctx) => <AttemptTimelineWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptTimelineText(props.data, ctx),
});

// ───────────────────────── AttemptConversation ─────────────────────────

function validateConversationData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (!Array.isArray(data.rounds)) return 'missing "rounds" (array)';
  return null;
}

export const AttemptConversation = makeAttemptComponent<AttemptConversationData>({
  name: "AttemptConversation",
  dataFnName: "attemptConversationData",
  shapeName: "AttemptConversationData",
  dataFn: attemptConversationData,
  validate: validateConversationData,
  web: (props, ctx) => <AttemptConversationWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptConversationText(props.data, ctx),
});

// ───────────────────────── AttemptDiagnostics ─────────────────────────

function validateDiagnosticsData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (!Array.isArray(data.groups)) return 'missing "groups" (array)';
  return null;
}

export const AttemptDiagnostics = makeAttemptComponent<AttemptDiagnosticsData>({
  name: "AttemptDiagnostics",
  dataFnName: "attemptDiagnosticsData",
  shapeName: "AttemptDiagnosticsData",
  dataFn: attemptDiagnosticsData,
  validate: validateDiagnosticsData,
  web: (props, ctx) => <AttemptDiagnosticsWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptDiagnosticsText(props.data, ctx),
});

// ───────────────────────── AttemptUsage ─────────────────────────

function validateUsageData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (!isObject(data.usage)) return 'missing "usage" (object)';
  return null;
}

export const AttemptUsage = makeAttemptComponent<AttemptUsageData>({
  name: "AttemptUsage",
  dataFnName: "attemptUsageData",
  shapeName: "AttemptUsageData",
  dataFn: attemptUsageData,
  validate: validateUsageData,
  web: (props, ctx) => <AttemptUsageWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptUsageText(props.data, ctx),
});

// ───────────────────────── AttemptTrace ─────────────────────────

function validateTraceData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (!Array.isArray(data.spans)) return 'missing "spans" (array)';
  return null;
}

export const AttemptTrace = makeAttemptComponent<AttemptTraceData>({
  name: "AttemptTrace",
  dataFnName: "attemptTraceData",
  shapeName: "AttemptTraceData",
  dataFn: attemptTraceData,
  validate: validateTraceData,
  web: (props, ctx) => <AttemptTraceWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptTraceText(props.data, ctx),
});

// ───────────────────────── AttemptDiff ─────────────────────────

function validateDiffData(data: unknown): string | null {
  if (!isObject(data)) return "expected an object";
  if (typeof data.locator !== "string") return 'missing "locator" (string)';
  if (!Array.isArray(data.files)) return 'missing "files" (array)';
  return null;
}

export const AttemptDiff = makeAttemptComponent<AttemptDiffData>({
  name: "AttemptDiff",
  dataFnName: "attemptDiffData",
  shapeName: "AttemptDiffData",
  dataFn: attemptDiffData,
  validate: validateDiffData,
  web: (props, ctx) => <AttemptDiffWeb data={props.data} className={props.className} />,
  text: (props, ctx) => attemptDiffText(props.data, ctx),
});

// ───────────────────────── 两个普通组合组件 ─────────────────────────

/** source / assertions fallback:有 source 放 AttemptSource,否则放 AttemptAssertions。 */
export const AttemptAssessment = defineComponent((_props: Record<string, never>, ctx) => {
  if (ctx.page.input !== "attempt") {
    throw new Error(
      "AttemptAssessment requires an attempt-input page (input: \"attempt\") — it reads ctx.page.evidence to choose between AttemptSource and AttemptAssertions.",
    );
  }
  return (
    <Col>
      <AttemptError />
      {ctx.page.evidence.capabilities.source ? <AttemptSource /> : <AttemptAssertions />}
    </Col>
  );
});
AttemptAssessment.displayName = "AttemptAssessment";

/** 内建排列顺序;不产生新的 data 或渲染面,用户可以在自己的 attempt-input page 里重排这些叶子。 */
export const AttemptDetail = defineComponent(() => (
  <Col>
    <AttemptSummary />
    <AttemptAssessment />
    <AttemptFixPrompt />
    <AttemptTimeline />
    <AttemptDiagnostics />
    <AttemptUsage />
    <AttemptConversation />
    <AttemptTrace />
    <AttemptDiff />
  </Col>
));
AttemptDetail.displayName = "AttemptDetail";
