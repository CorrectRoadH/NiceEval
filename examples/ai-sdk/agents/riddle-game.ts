import { defineAgent } from "fasteval";
import type { StreamEvent, Usage } from "fasteval";
import type { AgentEvent, AgentResponse, JsonValue } from "../ai-sdk-agent/src/protocol.ts";

const DEFAULT_AGENT_URL = "http://127.0.0.1:5188";

export const riddleWebAgent = defineAgent({
  name: "riddle-web",
  capabilities: {
    conversation: true,
    toolObservability: true,
  },

  async send(input, ctx) {
    const baseUrl = process.env.RIDDLE_AGENT_URL ?? DEFAULT_AGENT_URL;

    try {
      const response = await fetch(`${baseUrl}/api/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: ctx.session.id,
          message: input.text,
          model: ctx.model,
        }),
        signal: ctx.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return failedTurn(`web agent returned HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`);
      }

      const body = parseAgentResponse(await response.json());
      ctx.session.id = body.sessionId;

      return {
        events: body.events.map(toStreamEvent),
        data: body.data,
        status: "completed" as const,
        usage: body.usage ? toUsage(body.usage) : undefined,
      };
    } catch (error) {
      return failedTurn(error instanceof Error ? error.message : String(error));
    }
  },
});

export default riddleWebAgent;

function parseAgentResponse(value: unknown): AgentResponse {
  if (typeof value !== "object" || value === null) throw new Error("web agent response must be an object.");
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string") throw new Error("web agent response missing sessionId.");
  if (!Array.isArray(record.events)) throw new Error("web agent response missing events array.");

  return {
    sessionId: record.sessionId,
    reply: typeof record.reply === "string" ? record.reply : "",
    events: record.events.map(parseAgentEvent),
    data: typeof record.data === "object" && record.data !== null ? (record.data as AgentResponse["data"]) : { lastAction: "unknown" },
    usage:
      typeof record.usage === "object" && record.usage !== null
        ? {
            inputTokens: numberField((record.usage as Record<string, unknown>).inputTokens) ?? 0,
            outputTokens: numberField((record.usage as Record<string, unknown>).outputTokens) ?? 0,
            requests: numberField((record.usage as Record<string, unknown>).requests),
          }
        : undefined,
  };
}

function parseAgentEvent(value: unknown): AgentEvent {
  if (typeof value !== "object" || value === null) throw new Error("agent event must be an object.");
  const record = value as Record<string, unknown>;
  if (record.type === "message" && (record.role === "assistant" || record.role === "user") && typeof record.text === "string") {
    return { type: "message", role: record.role, text: record.text };
  }
  if (record.type === "action.called" && typeof record.callId === "string" && typeof record.name === "string") {
    return {
      type: "action.called",
      callId: record.callId,
      name: record.name,
      input: toJson(record.input),
      tool: typeof record.tool === "string" ? record.tool : undefined,
    };
  }
  if (record.type === "action.result" && typeof record.callId === "string") {
    return {
      type: "action.result",
      callId: record.callId,
      output: toJson(record.output),
      status:
        record.status === "failed" || record.status === "rejected" || record.status === "completed"
          ? record.status
          : "completed",
    };
  }
  if (record.type === "error" && typeof record.message === "string") {
    return { type: "error", message: record.message };
  }
  throw new Error(`unsupported agent event: ${JSON.stringify(value)}`);
}

function toStreamEvent(event: AgentEvent): StreamEvent {
  if (event.type === "action.called") {
    return { ...event, tool: "unknown" };
  }
  return event as StreamEvent;
}

function toUsage(usage: NonNullable<AgentResponse["usage"]>): Usage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    requests: usage.requests,
  };
}

function failedTurn(message: string) {
  return {
    status: "failed" as const,
    events: [{ type: "error" as const, message }],
  };
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toJson(value: unknown): JsonValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) out[key] = toJson(child);
    return out;
  }
  return null;
}
