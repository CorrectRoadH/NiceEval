// AttemptSource:带 send / assertion 标注的 eval 源码;行内展开 assertion 细节。
// 没有 source 时零输出(docs/feature/reports/library/attempt-detail.md)。send 标注只是
// 指向 AttemptConversation 完整回复的指针(status/耗时),不复制轮内内容——区块按事实
// 边界拆分,同一批事实不在两个组件里各展一份。

import type { ReactElement } from "react";
import type { AttemptSourceData } from "../types.ts";
import type { AssertionResult } from "../../types.ts";
import { cx } from "./format.ts";

function assertTone(a: AssertionResult): "good" | "warn" | "bad" | "na" {
  if (a.outcome === "unavailable") return "na";
  if (a.outcome === "passed") return "good";
  return a.severity === "soft" ? "warn" : "bad";
}

export function AttemptSource({ data, className }: { data: AttemptSourceData | null; className?: string }): ReactElement | null {
  if (data === null) return null;
  return (
    <div className={cx("nre", "nre-attempt-source", className)}>
      <div className="nre-attempt-source-head">{data.sourcePath}</div>
      <div className="nre-attempt-source-lines">
        {data.lines.map((line) => {
          const hasAsserts = line.assertions.length > 0;
          const hasSends = line.sends.length > 0;
          const worstTone = hasAsserts
            ? line.assertions.some((a) => assertTone(a) === "bad")
              ? "bad"
              : line.assertions.some((a) => assertTone(a) === "warn")
                ? "warn"
                : line.assertions.some((a) => assertTone(a) === "na")
                  ? "na"
                  : "good"
            : undefined;
          return (
            <details
              key={line.line}
              className={cx("nre-source-line", worstTone ? `nre-tone-${worstTone}` : undefined, hasSends ? "nre-source-line-send" : undefined)}
              open={hasAsserts && (worstTone === "bad" || worstTone === "warn")}
            >
              <summary>
                <span className="nre-source-ln">{line.line}</span>
                <code className="nre-source-text">{line.text}</code>
                {hasSends ? <span className="nre-source-send-mark">↳ {line.sends.map((s) => s.label).join(", ")}</span> : null}
              </summary>
              {hasAsserts ? (
                <div className="nre-source-line-detail">
                  {line.assertions.map((a, i) => (
                    <div key={i} className={`nre-assertion-row nre-tone-${assertTone(a)}`}>
                      <span className="nre-assertion-name">{a.name}</span>
                      {a.outcome === "unavailable" ? (
                        <span>{a.reason}</span>
                      ) : (
                        <>
                          {a.expected !== undefined ? <span>expected: {a.expected}</span> : null}
                          {a.received !== undefined ? <span>received: {a.received}</span> : null}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </details>
          );
        })}
      </div>
      {data.unmapped.length > 0 ? (
        <div className="nre-attempt-source-unmapped">
          <div className="nre-attempt-source-unmapped-head">Other assertions</div>
          {data.unmapped.map((a, i) => (
            <div key={i} className={`nre-assertion-row nre-tone-${assertTone(a)}`}>
              {a.groupPath?.length ? `${a.groupPath.join(" > ")} · ` : ""}
              {a.name}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
