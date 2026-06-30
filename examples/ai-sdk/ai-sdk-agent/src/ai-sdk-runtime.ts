import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentRequest, AgentResponse, AgentUsage, JsonValue } from "./protocol.ts";
import {
  getSession,
  giveHint,
  judgeGuess,
  rememberAiTurn,
  revealAnswer,
  selectRiddle,
  sessionMessages,
} from "./riddle.ts";

const SYSTEM_PROMPT = `
你是一个谜语游戏 web agent。你必须通过工具维护游戏状态。

规则：
1. 玩家要求出题时，调用 select_riddle，然后用工具返回的 riddle 出题；不能直接泄露 answer。
2. 玩家猜答案时，调用 judge_guess；答错时只给工具返回的提示，不能公布谜底。
3. 玩家要求提示时，调用 give_hint；提示必须有帮助但不直接说出谜底。
4. 玩家说放弃时，调用 reveal_answer。
5. 回复保持中文、友好、简短，每次不超过 3 句话。
`.trim();

interface ToolContext {
  toolCallId?: string;
}

interface SchemaBuilder {
  min(n: number): SchemaBuilder;
  optional(): SchemaBuilder;
  default(value: string): SchemaBuilder;
  describe(text: string): SchemaBuilder;
}

interface ToolFactory {
  tool(def: {
    description: string;
    inputSchema: unknown;
    execute(input: Record<string, unknown>, ctx: ToolContext): Promise<JsonValue> | JsonValue;
  }): unknown;
}

interface ZodFactory {
  object(shape: Record<string, unknown>): unknown;
  string(): SchemaBuilder;
  enum(values: readonly [string, ...string[]]): SchemaBuilder;
}

export async function handleAiSdkTurn(request: AgentRequest, signal?: AbortSignal): Promise<AgentResponse> {
  const [{ generateText, stepCountIs, tool }, { createOpenAI }, { z }] = await Promise.all([
    import("ai"),
    import("@ai-sdk/openai"),
    import("zod"),
  ]);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required when RIDDLE_AGENT_MODE=ai.");

  const session = getSession(request.sessionId);
  const events: AgentEvent[] = [];
  const openai = createOpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  const model = openai.chat(request.model ?? process.env.RIDDLE_AGENT_MODEL ?? "gpt-4o-mini");

  const tools = makeAiTools({
    tool,
    z,
    events,
    record(name, input, run) {
      const callId = `${name}-${randomUUID()}`;
      events.push({ type: "action.called", callId, name, input, tool: "unknown" });
      try {
        const output = run();
        events.push({ type: "action.result", callId, output, status: "completed" });
        return output;
      } catch (error) {
        events.push({
          type: "action.result",
          callId,
          output: { error: error instanceof Error ? error.message : String(error) },
          status: "failed",
        });
        throw error;
      }
    },
    session,
  });

  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: [...sessionMessages(session), { role: "user" as const, content: request.message }],
    tools,
    stopWhen: stepCountIs(5),
    abortSignal: signal,
  });

  const reply = result.text.trim() || "我已经处理了这一步。";
  rememberAiTurn(session, request.message, reply);
  events.push({ type: "message", role: "assistant", text: reply });

  return {
    sessionId: session.id,
    reply,
    events,
    data: {
      answer: session.current?.answer,
      currentRiddle: session.current?.prompt,
      lastAction: events.findLast((event) => event.type === "action.called")?.name ?? "chat",
    },
    usage: normalizeUsage(result),
  };
}

function makeAiTools({
  tool,
  z,
  record,
  session,
}: {
  tool: ToolFactory["tool"];
  z: ZodFactory;
  events: AgentEvent[];
  record<T extends JsonValue>(name: string, input: JsonValue, run: () => T): T;
  session: Parameters<typeof selectRiddle>[0];
}): Record<string, unknown> {
  return {
    select_riddle: tool({
      description: "Select a riddle from the curated bank and make it the active riddle.",
      inputSchema: z.object({
        topic: z.string().optional().describe("Optional topic preference, such as daily-object or weather."),
        difficulty: z.enum(["easy", "medium", "hard"]).default("easy").describe("Riddle difficulty."),
      }),
      execute: async (input) =>
        record("select_riddle", cleanInput(input), () =>
          selectRiddle(session, {
            topic: stringField(input.topic),
            difficulty: difficultyField(input.difficulty),
          }),
        ),
    }),
    judge_guess: tool({
      description: "Judge a player's guess against the active riddle.",
      inputSchema: z.object({
        guess: z.string().min(1).describe("The player's guessed answer."),
      }),
      execute: async (input) =>
        record("judge_guess", cleanInput(input), () => judgeGuess(session, { guess: stringField(input.guess) ?? "" })),
    }),
    give_hint: tool({
      description: "Return the next safe hint for the active riddle without revealing the answer.",
      inputSchema: z.object({}),
      execute: async (input) => record("give_hint", cleanInput(input), () => giveHint(session)),
    }),
    reveal_answer: tool({
      description: "Reveal the answer only when the player gives up.",
      inputSchema: z.object({}),
      execute: async (input) => record("reveal_answer", cleanInput(input), () => revealAnswer(session)),
    }),
  };
}

function cleanInput(input: Record<string, unknown>): JsonValue {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }
  return out;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function difficultyField(value: unknown): "easy" | "medium" | "hard" | undefined {
  return value === "easy" || value === "medium" || value === "hard" ? value : undefined;
}

function normalizeUsage(result: unknown): AgentUsage | undefined {
  const record = asRecord(result);
  const usage = asRecord(record.usage) ?? asRecord(record.totalUsage);
  if (!usage) return undefined;

  const inputTokens = numberField(usage.inputTokens) ?? numberField(usage.promptTokens) ?? 0;
  const outputTokens = numberField(usage.outputTokens) ?? numberField(usage.completionTokens) ?? 0;
  return { inputTokens, outputTokens, requests: 1 };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
