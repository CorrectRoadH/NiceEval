import type { Vars } from "../../i18n/core.ts";
import type { MessageKey } from "./i18n.ts";
import type { CodeSource, TranscriptEvent, ViewJson } from "./types.ts";

export type T = (key: MessageKey, vars?: Vars) => string;
export type ArtifactLoadState =
  | { sources: CodeSource[] | null; events: TranscriptEvent[] | null; status: "loading" | "ready" | "none" };
export type ToolBlockCall = { tool?: string; name: string; input: ViewJson };
