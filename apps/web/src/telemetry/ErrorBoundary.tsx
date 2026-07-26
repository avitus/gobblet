import { Banner, Button, Card } from "@gobblet/design-system";
import { Component, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useTelemetry } from "./provider";
import type { TelemetryReporter } from "./reporter";
import { routePattern } from "./route-pattern";

type BoundaryProps = Readonly<{
  children: ReactNode;
  telemetry: TelemetryReporter;
  route: string;
}>;

type BoundaryState = Readonly<{ failed: boolean }>;

class ReportingBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    this.props.telemetry.reportError({
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      route: this.props.route,
    });
  }

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <Card title="Something in the page failed">
        <Banner tone="error">
          The screen stopped rather than showing you something wrong. The failure has been reported.
        </Banner>
        <Button
          variant="secondary"
          onClick={() => {
            this.setState({ failed: false });
          }}
          data-testid="boundary-retry"
        >
          Try again
        </Button>
      </Card>
    );
  }
}

/**
 * The last stop for a render that threw: the player sees a page rather than a blank
 * document, and the server hears about it once (spec section 17.2). A new route
 * mounts a new boundary, so leaving a broken screen is enough to recover.
 */
export function AppErrorBoundary({
  children,
}: Readonly<{ children: ReactNode }>): React.JSX.Element {
  const telemetry = useTelemetry();
  const location = useLocation();
  const route = routePattern(location.pathname);

  return (
    <ReportingBoundary key={route} telemetry={telemetry} route={route}>
      {children}
    </ReportingBoundary>
  );
}
