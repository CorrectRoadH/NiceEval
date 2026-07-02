import type { Vars } from "../../i18n/core.ts";
import type { MessageKey } from "./i18n.ts";
import type { CodeSource, TranscriptEvent, ViewJson, ViewResult } from "./types.ts";

export type T = (key: MessageKey, vars?: Vars) => string;
export type OpenModal = (result: ViewResult) => void;
export type ArtifactLoadState =
  | { sources: CodeSource[] | null; events: TranscriptEvent[] | null; status: "loading" | "ready" | "none" };
export type RowRun = ViewResult & { rowLabel: string; rowAgent: string; rowModel?: string };
export type LazyArtifactType = "trace" | "transcript";
export type ToolBlockCall = { tool?: string; name: string; input: ViewJson };
