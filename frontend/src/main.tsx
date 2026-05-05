import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PopoutChart from "./components/PopoutChart";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isPopoutWindow } from "./lib/chartBroadcast";
import { TickerProvider } from "./contexts/TickerContext";
import "./index.css";

const isPopout = isPopoutWindow();

// Log unhandled errors to console only — no page reloads.
// A reload during live trading loses automation state and open position tracking.
window.addEventListener('error', (e) => console.error('[error]', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandledrejection]', e.reason));

const rootEl = document.getElementById("root") as HTMLElement;

ReactDOM.createRoot(rootEl).render(
  isPopout
    ? <PopoutChart />
    : (
      <ErrorBoundary componentName="Horizon Alpha">
        <TickerProvider>
          <App />
        </TickerProvider>
      </ErrorBoundary>
    )
);
