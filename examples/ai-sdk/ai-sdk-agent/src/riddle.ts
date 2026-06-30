import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentRequest, AgentResponse, JsonValue } from "./protocol.ts";

type Difficulty = "easy" | "medium" | "hard";

interface Riddle {
  id: string;
  answer: string;
  topic: string;
  difficulty: Difficulty;
  prompt: string;
  hints: string[];
}

interface SessionState {
  id: string;
  current?: Riddle;
  hintIndex: number;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ToolRecorder {
  recordTool<T extends JsonValue>(name: string, input: JsonValue, run: () => T): T;
}

const riddleBank: Riddle[] = [
  {
    id: "mirror",
    answer: "镜子",
    topic: "daily-object",
    difficulty: "easy",
    prompt: "我有眼睛却看不见，有嘴巴却不说话。你站在我面前，我总把另一个你带来。我是什么？",
    hints: ["它常在墙上或洗手台旁。", "它不会说话，却会如实反映你的样子。"],
  },
  {
    id: "umbrella",
    answer: "雨伞",
    topic: "weather",
    difficulty: "medium",
    prompt: "晴天我常被遗忘，雨天我张开一朵移动的花。人们把我举过头顶，却不让我飞走。我是什么？",
    hints: ["它和天气有关。", "它展开后能替你挡住落下的水。"],
  },
  {
    id: "clock",
    answer: "钟表",
    topic: "daily-object",
    difficulty: "medium",
    prompt: "我不停地走，却从不离开原地。我的脚步很安静，却催着所有人向前。我是什么？",
    hints: ["它和时间有关。", "它可能挂在墙上，也可能戴在手上。"],
  },
];

const sessions = new Map<string, SessionState>();

export function getSession(sessionId?: string): SessionState {
  const id = sessionId?.trim() || `riddle-${randomUUID()}`;
  const existing = sessions.get(id);
  if (existing) return existing;
  const next: SessionState = { id, hintIndex: 0, messages: [] };
  sessions.set(id, next);
  return next;
}

export function selectRiddle(
  session: SessionState,
  input: { topic?: string; difficulty?: Difficulty },
): { riddleId: string; riddle: string; topic: string; difficulty: Difficulty } {
  const requestedDifficulty = input.difficulty ?? "easy";
  const selected =
    riddleBank.find((r) => r.topic === input.topic && r.difficulty === requestedDifficulty) ??
    riddleBank.find((r) => r.difficulty === requestedDifficulty) ??
    riddleBank[0];

  session.current = selected;
  session.hintIndex = 0;

  return {
    riddleId: selected.id,
    riddle: selected.prompt,
    topic: selected.topic,
    difficulty: selected.difficulty,
  };
}

export function judgeGuess(
  session: SessionState,
  input: { guess: string },
): { correct: boolean; answer?: string; feedback: string; hint?: string } {
  if (!session.current) {
    return { correct: false, feedback: "请先说「出题」让我出一道谜语吧。" };
  }

  const normalizedGuess = normalize(input.guess);
  const normalizedAnswer = normalize(session.current.answer);
  const correct = normalizedGuess.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedGuess);

  if (correct) {
    return {
      correct: true,
      answer: session.current.answer,
      feedback: `答对了！谜底就是${session.current.answer}。`,
    };
  }

  const hint = nextHint(session);
  return {
    correct: false,
    feedback: "猜错了，再想想。",
    hint,
  };
}

export function giveHint(session: SessionState): { hint: string; answerRevealed: false } {
  if (!session.current) {
    return { hint: "请先说「出题」让我出一道谜语吧。", answerRevealed: false };
  }
  return { hint: nextHint(session), answerRevealed: false };
}

export function revealAnswer(session: SessionState): { answer?: string; reply: string } {
  if (!session.current) return { reply: "还没有题目。先说「出题」吧。" };
  return {
    answer: session.current.answer,
    reply: `好的，谜底是「${session.current.answer}」。`,
  };
}

export function makeRecorder(events: AgentEvent[]): ToolRecorder {
  return {
    recordTool(name, input, run) {
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
  };
}

export function handleMockTurn(request: AgentRequest): AgentResponse {
  const session = getSession(request.sessionId);
  const events: AgentEvent[] = [];
  const tools = makeRecorder(events);
  const text = request.message.toLowerCase();

  let reply: string;
  let lastAction = "chat";

  if (text.includes("出题")) {
    const result = tools.recordTool("select_riddle", { topic: "daily-object", difficulty: "easy" }, () =>
      selectRiddle(session, { topic: "daily-object", difficulty: "easy" }),
    );
    reply = `谜语来了：${result.riddle}`;
    lastAction = "select_riddle";
  } else if (text.includes("提示")) {
    const result = tools.recordTool("give_hint", {}, () => giveHint(session));
    reply = `提示：${result.hint}`;
    lastAction = "give_hint";
  } else if (text.includes("放弃")) {
    const result = tools.recordTool("reveal_answer", {}, () => revealAnswer(session));
    reply = result.reply;
    lastAction = "reveal_answer";
  } else {
    const result = tools.recordTool("judge_guess", { guess: request.message }, () =>
      judgeGuess(session, { guess: request.message }),
    );
    reply = result.correct ? result.feedback : `${result.feedback}${result.hint ? ` 提示：${result.hint}` : ""}`;
    lastAction = "judge_guess";
  }

  session.messages.push({ role: "user", content: request.message }, { role: "assistant", content: reply });
  events.push({ type: "message", role: "assistant", text: reply });

  return {
    sessionId: session.id,
    reply,
    events,
    data: {
      answer: session.current?.answer,
      currentRiddle: session.current?.prompt,
      lastAction,
    },
    usage: { inputTokens: estimateTokens(request.message), outputTokens: estimateTokens(reply), requests: 1 },
  };
}

export function rememberAiTurn(session: SessionState, user: string, assistant: string): void {
  session.messages.push({ role: "user", content: user }, { role: "assistant", content: assistant });
}

export function sessionMessages(session: SessionState): Array<{ role: "user" | "assistant"; content: string }> {
  return session.messages.slice(-12);
}

function nextHint(session: SessionState): string {
  const current = session.current;
  if (!current) return "请先说「出题」让我出一道谜语吧。";
  const hint = current.hints[Math.min(session.hintIndex, current.hints.length - 1)] ?? "它就在日常生活里。";
  session.hintIndex += 1;
  return hint;
}

function normalize(value: string): string {
  return value.replace(/[^\p{Letter}\p{Number}]/gu, "").toLowerCase();
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 3));
}
