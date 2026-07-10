import { createRoot } from "react-dom/client";
import type { ViewData } from "./types.ts";
import { App } from "./App.tsx";
import "../styles.css";

// 没有烘焙数据(比如直接打开裸产物)时的空页面兜底,形状与官方数据契约一致。
const emptyViewData: ViewData = {
  composedRuns: 0,
  overview: {
    snapshots: [],
    totals: { evals: 0, attempts: 0, passed: 0, failed: 0, errored: 0, skipped: 0, costUSD: null, durationMs: 0 },
    warnings: [],
  },
  table: { dimension: "experiment", columns: [], rows: [] },
  overall: { dimension: "overall", columns: [], rows: [] },
  snapshots: [],
};

const initialData: ViewData = window.__NICEEVAL_VIEW_DATA__ ?? emptyViewData;

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(<App data={initialData} />);
