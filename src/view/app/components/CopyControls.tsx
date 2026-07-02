import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { T } from "../shared.ts";
import type { ViewResult, ViewRow } from "../types.ts";
import { failingAssertions, reasonFor } from "../lib/outcome.ts";

export function CopyReason({ text, t }: { text: string; t: T }) {
  const [copied, setCopied] = useState(false);
  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button className={`copy-reason${copied ? " is-copied" : ""}`} onClick={copy} aria-label={t("action.copyReason")} title={t("action.copyReason")}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

export function CopyAllErrors({ rows, t }: { rows: ViewRow[]; t: T }) {
  const [copied, setCopied] = useState(false);

  const errorEntries = rows.flatMap((row: ViewRow) =>
    (row.results ?? [])
      .filter((r: ViewResult) => {
        return r.outcome === "failed" || r.outcome === "errored";
      })
      .map((r: ViewResult) => {
        const failedAssertions = failingAssertions(r);
        const reason = reasonFor(r, failedAssertions);
        // 静态 HTML 里只有相对 view 根的工件路径;宿主机绝对路径不再进 viewData。
        const traceBase = r.artifactBase;
        const tracePath = r.hasTrace && traceBase ? `${traceBase}/trace.json` : null;
        return { experimentName: row.label, evalId: r.id, reason, tracePath };
      })
  );

  if (!errorEntries.length) return null;

  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const text = errorEntries
      .map(({ experimentName, evalId, reason, tracePath }: { experimentName: string; evalId: string; reason: string; tracePath: string | null }) =>
        [
          `实验: ${experimentName}  Eval: ${evalId}`,
          reason ? `错误: ${reason}` : null,
          tracePath ? `Trace: ${tracePath}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button className={`copy-all-errors${copied ? " is-copied" : ""}`} onClick={copy} title={t("action.copyErrors")}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? t("action.copied") : `${t("action.copyErrors")} (${errorEntries.length})`}</span>
    </button>
  );
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}
