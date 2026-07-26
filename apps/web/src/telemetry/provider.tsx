import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useApi } from "../api/provider";
import { clientConfig } from "../config";
import { createTelemetryReporter, type TelemetryReporter } from "./reporter";
import { routePattern } from "./route-pattern";

const TelemetryContext = createContext<TelemetryReporter | null>(null);

/** A reporter that sends nothing, which is what a component outside the provider gets. */
export const SILENT_REPORTER: TelemetryReporter = Object.freeze({
  capture: () => undefined,
  reportError: () => undefined,
  flush: () => Promise.resolve(),
});

export function useTelemetry(): TelemetryReporter {
  return useContext(TelemetryContext) ?? SILENT_REPORTER;
}

export type TelemetryProviderProps = Readonly<{
  children: ReactNode;
  reporter?: TelemetryReporter;
}>;

/**
 * Reports the launch, then whatever the page fails at: an uncaught error and a
 * rejected promise both become one report through the server (spec section 17.2).
 * The listeners are on `window` because a React boundary sees only what React threw.
 */
export function TelemetryProvider({
  children,
  reporter,
}: TelemetryProviderProps): React.JSX.Element {
  const api = useApi();
  const telemetry = useMemo(() => reporter ?? createTelemetryReporter({ api }), [reporter, api]);

  useEffect(() => {
    telemetry.capture({
      name: "app-launched",
      platform: "web",
      clientVersion: clientConfig.clientVersion,
    });
  }, [telemetry]);

  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      telemetry.reportError({
        name: event.error instanceof Error ? event.error.name : "Error",
        message: event.message === "" ? "An uncaught error" : event.message,
        ...(event.error instanceof Error && event.error.stack !== undefined
          ? { stack: event.error.stack }
          : {}),
        route: routePattern(window.location.pathname),
      });
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason: unknown = event.reason;
      telemetry.reportError({
        name: reason instanceof Error ? reason.name : "UnhandledRejection",
        message: reason instanceof Error ? reason.message : String(reason),
        ...(reason instanceof Error && reason.stack !== undefined ? { stack: reason.stack } : {}),
        route: routePattern(window.location.pathname),
      });
    };
    // A page going away still owes the server the batch it is holding.
    const onHidden = (): void => {
      void telemetry.flush();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("pagehide", onHidden);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("pagehide", onHidden);
    };
  }, [telemetry]);

  return <TelemetryContext.Provider value={telemetry}>{children}</TelemetryContext.Provider>;
}
