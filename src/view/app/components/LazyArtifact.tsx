import { useEffect, useState } from "react";
import type { LazyArtifactType, T } from "../shared.ts";
import { artifactUrl } from "../lib/artifact-url.ts";
import { asEvents, asSpans } from "../lib/guards.ts";
import { Trace } from "./Trace.tsx";
import { Transcript } from "./Transcript.tsx";

export function LazyArtifact({ type, src, autoLoad = false, t }: { type: LazyArtifactType; src: string; autoLoad?: boolean; t: T }) {
  const [open, setOpen] = useState(autoLoad);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState<unknown>(null);
  const [error, setError] = useState("");

  const load = async () => {
    if (loaded) return;
    setLoaded(true);
    try {
      const resp = await fetch(artifactUrl(src));
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const body = await resp.json();
      setContent(body);
      setError("");
    } catch (e) {
      setLoaded(false);
      setError(`${t("trace.loadFailed")} ${String(e)}`);
    }
  };

  useEffect(() => {
    if (autoLoad) void load();
  }, []);

  return (
    <details
      className="trace-details"
      open={open}
      onToggle={(e) => {
        const isOpen = e.currentTarget.open;
        setOpen(isOpen);
        if (isOpen) void load();
      }}
    >
      <summary>{type === "transcript" ? t("trace.transcript") : t("trace.timing")}</summary>
      <div className="trace-slot">
        {error ? <div className="trace-span-meta">{error}</div> : !content ? <div className="trace-span-meta">{t("trace.loading")}</div> : null}
        {content && type === "transcript" ? <Transcript events={asEvents(content) ?? []} t={t} /> : null}
        {content && type === "trace" ? <Trace spans={asSpans(content) ?? []} t={t} /> : null}
      </div>
    </details>
  );
}
