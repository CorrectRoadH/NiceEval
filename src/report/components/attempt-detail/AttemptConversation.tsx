// AttemptConversation:标准事件流按轮组织的完整分轮事件卡。没有 events 时零输出
// (docs/feature/reports/library/attempt-detail.md)。

import type { ReactElement, ReactNode } from "react";
import type { AttemptConversationData, AttemptConversationReply, AttemptConversationRound } from "../../model/types.ts";
import { cx } from "../shared.ts";

function ReplyRow({ reply }: { reply: AttemptConversationReply }): ReactNode {
  switch (reply.kind) {
    case "assistant":
      return (
        <div className="nre-conv-assistant">
          <span className="nre-conv-role">assistant</span>
          <div className="nre-conv-text">{reply.text}</div>
        </div>
      );
    case "user":
      return (
        <div className="nre-conv-user">
          <span className="nre-conv-role">user</span>
          <div className="nre-conv-text">{reply.text}</div>
        </div>
      );
    case "thinking":
      return (
        <details className="nre-conv-thinking">
          <summary>thinking</summary>
          <div className="nre-conv-text">{reply.text}</div>
        </details>
      );
    case "error":
      return <div className="nre-conv-error">! {reply.text}</div>;
    case "skill":
      return (
        <div className="nre-conv-skill">
          <span className="nre-conv-role">skill loaded</span> {reply.skill}
        </div>
      );
    case "tool":
      return (
        <details className="nre-conv-tool">
          <summary>
            {reply.name}
            {reply.status ? ` · ${reply.status}` : ""}
          </summary>
          <pre className="nre-conv-tool-io">{JSON.stringify(reply.input, null, 2)}</pre>
          {reply.output !== undefined ? <pre className="nre-conv-tool-io">{JSON.stringify(reply.output, null, 2)}</pre> : null}
        </details>
      );
    case "subagent":
      return (
        <details className="nre-conv-subagent">
          <summary>
            subagent {reply.name}
            {reply.status ? ` · ${reply.status}` : ""}
          </summary>
          {reply.output !== undefined ? <pre className="nre-conv-tool-io">{JSON.stringify(reply.output, null, 2)}</pre> : null}
        </details>
      );
    case "input":
      return <div className="nre-conv-input">input requested{reply.request.prompt ? `: ${reply.request.prompt}` : ""}</div>;
    case "compaction":
      return <div className="nre-conv-compaction">compaction{reply.reason ? `: ${reply.reason}` : ""}</div>;
    case "raw":
      return (
        <details className="nre-conv-raw">
          <summary>unrecognized event</summary>
          <pre className="nre-conv-tool-io">{JSON.stringify(reply.raw, null, 2)}</pre>
        </details>
      );
  }
}

function RoundCard({ round, index }: { round: AttemptConversationRound; index: number }): ReactElement {
  return (
    <div className="nre-conv-round">
      <div className="nre-conv-round-head">
        round {index + 1}
        {round.loc ? (
          <span className="nre-conv-round-loc" title={`${round.loc.file}:${round.loc.line}`}>
            {round.loc.file.split("/").pop()}:{round.loc.line}
          </span>
        ) : null}
      </div>
      {round.sentText ? <div className="nre-conv-sent">{round.sentText}</div> : null}
      <div className="nre-conv-replies">
        {round.replies.map((reply, i) => (
          <ReplyRow key={i} reply={reply} />
        ))}
      </div>
    </div>
  );
}

export function AttemptConversation({
  data,
  className,
}: {
  data: AttemptConversationData | null;
  className?: string;
}): ReactElement | null {
  if (data === null) return null;
  return (
    <div className={cx("nre", "nre-attempt-conversation", className)}>
      {data.rounds.map((round, i) => (
        <RoundCard key={i} round={round} index={i} />
      ))}
    </div>
  );
}
