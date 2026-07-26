import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ApiProvider } from "./api/provider";
import { AppRoutes } from "./app/routes";
import { SocketProvider } from "./match/provider";
import { SoundProvider } from "./sound/provider";
import { AppErrorBoundary } from "./telemetry/ErrorBoundary";
import { TelemetryProvider } from "./telemetry/provider";
import "@gobblet/design-system/tokens.css";
import "@gobblet/design-system/base.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root container in index.html");
}

createRoot(container).render(
  <StrictMode>
    <ApiProvider>
      <TelemetryProvider>
        <SocketProvider>
          <SoundProvider>
            <BrowserRouter>
              <AppErrorBoundary>
                <AppRoutes />
              </AppErrorBoundary>
            </BrowserRouter>
          </SoundProvider>
        </SocketProvider>
      </TelemetryProvider>
    </ApiProvider>
  </StrictMode>,
);
