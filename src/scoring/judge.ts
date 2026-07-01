// LLM-as-judge:用一个与被测 agent 完全分离的评判模型做结构化 autoevals 评分。
//
// 评判模型走 OpenAI 兼容的 /chat/completions。base_url + key 解析优先级:
//   judge.baseUrl / judge.apiKeyEnv  →  FASTEVAL_JUDGE_BASE / CODEX_BASE_URL  →  OpenAI 官方
//
// closedQA / factuality / summarizes 直接用 autoevals 库(braintrust)。

import { ClosedQA, Factuality, Summary } from "autoevals";
import type { EvalScore } from "./collector.ts";
import type { AssertionHandle, AutoevalsNamespace, JudgeConfig, JudgeNamespace, ScoringContext } from "../types.ts";
import { getEnv } from "../util.ts";
import { t } from "../i18n/index.ts";

interface ResolvedJudge {
  model: string;
  baseUrl: string;
  apiKey: string | undefined;
}

function resolveJudge(judge: JudgeConfig | undefined): ResolvedJudge {
  const model = judge?.model ?? "gpt-5.4-mini";
  const baseUrl =
    judge?.baseUrl ??
    getEnv("FASTEVAL_JUDGE_BASE") ??
    getEnv("CODEX_BASE_URL") ??
    getEnv("OPENAI_BASE_URL") ??
    "https://api.openai.com/v1";
  const apiKey =
    (judge?.apiKeyEnv ? getEnv(judge.apiKeyEnv) : undefined) ??
    getEnv("FASTEVAL_JUDGE_KEY") ??
    getEnv("CODEX_API_KEY") ??
    getEnv("OPENAI_API_KEY");
  return { model, baseUrl, apiKey };
}

/** 调评判模型,返回分数和原始推理文本。失败抛(collector 会兜成 0 分)。 */
async function callJudge(
  judge: ResolvedJudge,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<EvalScore> {
  if (!judge.apiKey) throw new Error(t("judge.apiKeyMissing"));
  const url = `${judge.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${judge.apiKey}`,
    },
    body: JSON.stringify({
      model: judge.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(t("judge.httpError", { status: res.status, body: body.slice(0, 300) }));
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  // evidence = 实际发给裁判的用户内容(材料 + 问题/标准)。view 展开就能看到「裁判到底读了什么」,
  // 一眼分辨 0 分是回答真不行,还是喂错了材料(例如对话 eval 误喂 diff)。
  return { ...parseJudgeReply(content), evidence: user };
}

/**
 * 解析评判回复:优先 JSON {reasoning, score}(detail = 理由,view 展开看 CoT);
 * 退化到纯数字 / 自由文本时 detail 落原文。
 */
function parseJudgeReply(text: string): EvalScore {
  const json = text.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const obj = JSON.parse(json[0]) as { score?: unknown; reasoning?: unknown };
      const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : undefined;
      const score = typeof obj.score === "number" ? clamp01(obj.score) : parseScore(text);
      return { score, detail: reasoning || text || undefined };
    } catch {
      // 落到下面的纯文本解析
    }
  }
  return { score: parseScore(text), detail: text || undefined };
}

/** 从模型回复里抠出 [0,1] 分。优先 JSON {score},否则取第一个数字。 */
function parseScore(text: string): number {
  const jsonMatch = text.match(/\{[^}]*"score"[^}]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as { score?: unknown };
      if (typeof obj.score === "number") return clamp01(obj.score);
    } catch {
      // 落到下面的数字提取
    }
  }
  const num = text.match(/(\d+(?:\.\d+)?)/);
  if (num) {
    let n = Number(num[1]);
    if (n > 1 && n <= 100) n = n / 100; // 容忍 0–100 / 0–10
    else if (n > 1 && n <= 10) n = n / 10;
    return clamp01(n);
  }
  return 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export interface JudgeDeps {
  record(spec: {
    name: string;
    severity: "soft";
    evaluate(ctx: ScoringContext): Promise<EvalScore>;
  }): AssertionHandle;
  judge: JudgeConfig | undefined;
  getOutput: () => string;
  /** 最后一条用户消息,作为 autoevals 的 input 字段。 */
  getInput: () => string;
  signal?: AbortSignal;
}

/** 没解析到 judge key 时返回的 no-op 命名空间:judge 断言静默跳过(不记录)。 */
function noOpJudge(): JudgeNamespace {
  const handle: AssertionHandle = {
    atLeast: () => handle,
    gate: () => handle,
  };
  const skip = () => handle;
  const noOpAutoevals: AutoevalsNamespace = { closedQA: skip, factuality: skip, summarizes: skip };
  return { autoevals: noOpAutoevals };
}

/** 预检显式配置的 judge:验证 API key 存在并发最小请求确认端点可达。
 *  返回错误描述字符串,可达则返回 undefined。*/
export async function probeJudge(judge: JudgeConfig, signal?: AbortSignal): Promise<string | undefined> {
  const resolved = resolveJudge(judge);
  if (!resolved.apiKey) {
    const envHint = judge.apiKeyEnv ?? "FASTEVAL_JUDGE_KEY / OPENAI_API_KEY";
    return t("judge.probeMissingKey", { model: resolved.model, envHint });
  }
  try {
    await callJudge(resolved, "Reply with the number 1 only.", "1", signal);
  } catch (e) {
    return t("judge.probeFailed", { model: resolved.model, error: e instanceof Error ? e.message : String(e) });
  }
  return undefined;
}

/** 构造 t.judge 命名空间。每个方法 record 一条延迟 soft 断言。 */
export function buildJudge(deps: JudgeDeps): JudgeNamespace {
  const resolved = resolveJudge(deps.judge);
  // 没 key 就静默跳过 judge —— eval 不必再手动 gate「环境里有没有 judge key」。
  if (!resolved.apiKey) return noOpJudge();

  const materialFor = async (ctx: ScoringContext, on?: string): Promise<string> => {
    if (on) {
      // on 既可能是沙箱里的文件路径,也可能是一段字面文本
      const fromFile = await ctx.readFile(on).catch(() => undefined);
      if (fromFile !== undefined) return `----- ${on} -----\n${fromFile}`;
      return on;
    }
    return deps.getOutput();
  };

  /** autoevals 公共参数:模型走 judge config,baseUrl + apiKey 透给 autoevals 内部建的 OpenAI client。 */
  const autoevalsBase = {
    model: resolved.model,
    openAiBaseUrl: resolved.baseUrl,
    openAiApiKey: resolved.apiKey,
  } as const;

  const closedQA = (criteria: string, opts?: { on?: string; model?: string }) =>
    deps.record({
      name: "judge:autoevals:closedQA",
      severity: "soft",
      evaluate: async (ctx) => {
        const output = await materialFor(ctx, opts?.on);
        const result = await ClosedQA({
          input: deps.getInput(),
          output,
          criteria,
          ...autoevalsBase,
          ...(opts?.model ? { model: opts.model } : {}),
        });
        return { score: clamp01(result.score ?? 0), detail: (result as { rationale?: string }).rationale || undefined, evidence: output };
      },
    });

  const factuality = (expected: string, opts?: { on?: string; model?: string }) =>
    deps.record({
      name: "judge:autoevals:factuality",
      severity: "soft",
      evaluate: async (ctx) => {
        const output = await materialFor(ctx, opts?.on);
        const result = await Factuality({
          input: deps.getInput(),
          output,
          expected,
          ...autoevalsBase,
          ...(opts?.model ? { model: opts.model } : {}),
        });
        return { score: clamp01(result.score ?? 0), detail: (result as { rationale?: string }).rationale || undefined, evidence: output };
      },
    });

  const summarizes = (expected: string, opts?: { on?: string; model?: string }) =>
    deps.record({
      name: "judge:autoevals:summarizes",
      severity: "soft",
      evaluate: async (ctx) => {
        const output = await materialFor(ctx, opts?.on);
        const result = await Summary({
          input: deps.getInput(),
          output,
          expected,
          ...autoevalsBase,
          ...(opts?.model ? { model: opts.model } : {}),
        });
        return { score: clamp01(result.score ?? 0), detail: (result as { rationale?: string }).rationale || undefined, evidence: output };
      },
    });

  const autoevalsNs: AutoevalsNamespace = { closedQA, factuality, summarizes };

  return { autoevals: autoevalsNs };
}
