import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PopoutChart from "./components/PopoutChart";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isPopoutWindow } from "./lib/chartBroadcast";
import { TickerProvider } from "./contexts/TickerContext";
import "./index.css";

// Check if this is a popout chart window
const isPopout = isPopoutWindow();

// ─── Overnight resilience ───────────────────────────────────────────────
// Unattended sessions need to survive crashes without human intervention.
// Three layers of recovery, cheapest first:
//   1. Root ErrorBoundary → hard page reload if React crashes
//   2. Global error/rejection burst detector → reload if N errors in 10s
//   3. Blank-root watchdog → reload if #root is empty shortly after mount

const MAX_ERRORS_IN_WINDOW = 5;
const ERROR_WINDOW_MS = 10_000;
const RELOAD_COOLDOWN_MS = 30_000;
let errorTimestamps: number[] = [];
let lastReloadAttempt = 0;

const tryRecoverReload = (reason: string) => {
  const now = Date.now();
  if (now - lastReloadAttempt < RELOAD_COOLDOWN_MS) return;
  lastReloadAttempt = now;
  console.warn(`[watchdog] reloading — ${reason}`);
  window.location.reload();
};

const recordError = (label: string, detail: unknown) => {
  const now = Date.now();
  errorTimestamps = errorTimestamps.filter(t => now - t < ERROR_WINDOW_MS);
  errorTimestamps.push(now);
  console.error(`[watchdog] ${label}`, detail);
  if (errorTimestamps.length >= MAX_ERRORS_IN_WINDOW) {
    tryRecoverReload(`${errorTimestamps.length} errors in ${ERROR_WINDOW_MS / 1000}s`);
  }
};

window.addEventListener('error', (e) => recordError('window error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => recordError('unhandled rejection', e.reason));

const rootEl = document.getElementById("root") as HTMLElement;

ReactDOM.createRoot(rootEl).render(
  isPopout
    ? <PopoutChart />
    : (
      <ErrorBoundary componentName="Horizon Alpha" reloadOnError>
        <TickerProvider>
          <App />
        </TickerProvider>
      </ErrorBoundary>
    )
);

// Blank-root watchdog: if React fails to render anything at all, reload.
window.setTimeout(() => {
  if (!rootEl.hasChildNodes() || rootEl.innerHTML.trim() === '') {
    tryRecoverReload('root element empty 15s after mount');
  }
}, 15_000);
