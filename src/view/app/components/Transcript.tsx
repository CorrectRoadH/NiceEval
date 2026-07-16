import type { T, ToolBlockCall } from "../shared.ts";
import type { ObjectRecord, ToolResultEvent, TranscriptEvent } from "../types.ts";
import { TOOL_VERB, resultBody, toolPrimaryArg } from "../lib/transcript-data.tsx";
import { prettyJson, previewText, truncate } from "../lib/format.ts";

export function Transcript({ events, t }: { events: TranscriptEvent[]; t: T }) {
  if (!Array.isArray(events) || !events.length) return <div className="trace-span-meta">{t("transcript.noEvents")}</div>;
  const resultByCall = new Map<string, ToolResultEvent>();
  for (const event of events) {
    if (event.type === "action.result" || event.type === "subagent.completed") resultByCall.set(event.callId, event);
  }
  const pairedResult = new Set<string>();
  return (
    <div className="transcript">
      {events.map((event, index) => {
        switch (event.type) {
          case "message":
            return <MessageBlock event={event} t={t} key={index} />;
          case "thinking":
            return <ThinkBlock event={event} t={t} key={index} />;
          case "action.called": {
            const result = resultByCall.get(event.callId);
            if (result) pairedResult.add(event.callId);
            return <ToolBlock call={event} result={result} t={t} key={index} />;
          }
          case "subagent.called": {
            const result = resultByCall.get(event.callId);
            if (result) pairedResult.add(event.callId);
            return (
              <ToolBlock
                call={{ tool: "agent_task", name: event.name, input: { description: event.name, ...(event.remoteUrl ? { remoteUrl: event.remoteUrl } : {}) } }}
                result={result}
                t={t}
                key={index}
              />
            );
          }
          case "action.result":
          case "subagent.completed":
            return pairedResult.has(event.callId) ? null : (
              <ToolBlock call={{ tool: "unknown", name: "result", input: null }} result={event} t={t} key={index} />
            );
          case "input.requested":
            return <InputBlock event={event} t={t} key={index} />;
          case "skill.loaded":
            return (
              <div className="ts-skill" key={index}>
                <span className="ts-role">{t("transcript.skillLoaded")}</span>
                <div className="ts-text">{event.skill}</div>
              </div>
            );
          case "view.raw":
            return <RawEventBlock raw={event.raw} t={t} key={index} />;
          case "compaction":
            return (
              <div className="ts-compaction" key={index}>
                {t("transcript.contextCompacted")}{event.reason ? " · " + event.reason : ""}
              </div>
            );
          case "error":
            return (
              <div className="ts-error" key={index}>
                ! {event.message || "error"}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

/** 未识别事件的原样展示:摘要行带原始 type,展开是完整 JSON——不静默丢,方便发现新词汇后续补一等呈现。 */
export function RawEventBlock({ raw, t }: { raw: ObjectRecord; t: T }) {
  const type = typeof raw.type === "string" ? raw.type : "?";
  const body = prettyJson(raw);
  return (
    <details className="ts-tool-d ts-raw">
      <summary className="ts-row">
        <span className="ts-dot pending" />
        <span className="ts-tool">{type}</span>
        <span className="ts-preview">{t("transcript.rawEvent")}</span>
      </summary>
      <div className="ts-body">
        <pre className="attr-pre">{truncate(body, 8000)}</pre>
      </div>
    </details>
  );
}

export function MessageBlock({ event, t }: { event: Extract<TranscriptEvent, { type: "message" }>; t: T }) {
  const who = event.role === "assistant" ? "assistant" : "user";
  return (
    <div className={`ts-msg ts-${who}`}>
      <span className="ts-role">{who === "assistant" ? t("transcript.assistant") : t("transcript.user")}</span>
      <div className="ts-text">{event.text || ""}</div>
    </div>
  );
}

export function ThinkBlock({ event, t }: { event: Extract<TranscriptEvent, { type: "thinking" }>; t: T }) {
  return (
    <details className="ts-think">
      <summary>{t("transcript.thinking")}</summary>
      <div className="ts-think-text">{event.text || ""}</div>
    </details>
  );
}

export function InputBlock({ event, t }: { event: Extract<TranscriptEvent, { type: "input.requested" }>; t: T }) {
  const request = event.request || {};
  const opts = (request.options || []).map((o: { id: string; label?: string }) => o.label || o.id).filter(Boolean).join("  /  ");
  const body = (request.prompt || t("transcript.awaitingInput")) + (opts ? "\n[ " + opts + " ]" : "");
  return (
    <div className="ts-msg ts-input">
      <span className="ts-role">{t("transcript.inputRequested")}</span>
      <div className="ts-text">{body}</div>
    </div>
  );
}

export function ToolBlock({ call, result, t }: { call: ToolBlockCall; result?: ToolResultEvent; t: T }) {
  const verb = (call.tool ? TOOL_VERB[call.tool] : undefined) || call.name || call.tool || "tool";
  const arg = toolPrimaryArg(call);
  const label = arg ? `${verb}(${arg})` : verb;
  const status = result ? result.status : "pending";
  const dot = status === "failed" ? "bad" : status === "rejected" ? "warn" : status === "pending" ? "pending" : "good";
  const inputStr = call.input == null ? "" : prettyJson(call.input);
  const outBody = result ? resultBody(result.output) : "";
  const preview = result ? previewText(outBody) : t("transcript.running");
  return (
    <details className="ts-tool-d">
      <summary className="ts-row">
        <span className={`ts-dot ${dot}`} />
        <span className="ts-tool" title={label}>
          {label}
        </span>
        <span className="ts-preview">{truncate(preview, 140)}</span>
      </summary>
      <div className="ts-body">
        {inputStr ? (
          <div className="ts-field">
            <span className="ts-k">{t("transcript.input")}</span>
            <pre className="attr-pre">{truncate(inputStr, 4000)}</pre>
          </div>
        ) : null}
        {result ? (
          <div className="ts-field">
            <span className="ts-k">{t("transcript.output")}{result.status && result.status !== "completed" ? " · " + result.status : ""}</span>
            <pre className="attr-pre">{outBody ? truncate(outBody, 8000) : <span className="reason-empty">{t("transcript.empty")}</span>}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}
