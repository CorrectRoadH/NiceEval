import { createRoot } from "react-dom/client";
import type { ViewData } from "./types.ts";
import { App } from "./App.tsx";
import "../styles.css";

const initialData: ViewData = window.__NICEEVAL_VIEW_DATA__ ?? {
  rows: [],
  passRate: 0,
  resultCount: 0,
  durationMs: 0,
};

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(<App data={initialData} />);
