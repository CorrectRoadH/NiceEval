export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AgentEvent =
  | { type: "message"; role: "assistant" | "user"; text: string }
  | { type: "action.called"; callId: string; name: string; input: JsonValue; tool?: string }
  | {
      type: "action.result";
      callId: string;
      output?: JsonValue;
      status: "completed" | "failed" | "rejected";
    }
  | { type: "error"; message: string };

export interface AgentRequest {
  sessionId?: string;
  message: string;
  model?: string;
  mode?: "ai" | "mock";
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  requests?: number;
}

export interface AgentResponse {
  sessionId: string;
  reply: string;
  events: AgentEvent[];
  data: {
    answer?: string;
    currentRiddle?: string;
    lastAction: string;
  };
  usage?: AgentUsage;
}
