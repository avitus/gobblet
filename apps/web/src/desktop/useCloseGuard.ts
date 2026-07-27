import { useEffect, useRef } from "react";
import { installCloseGuard } from "./close-guard";
import { loadWindow, type DesktopWindow } from "./bridge";
import { isDesktop } from "./host";

export type CloseGuard = Readonly<{
  inMatch: boolean;
  confirm: () => Promise<boolean>;
  resign: () => Promise<void>;
  /** Supplied by the tests; the desktop loads its own window on mount. */
  window?: DesktopWindow;
}>;

/**
 * Registers the interception while the screen that owns a match is mounted, and
 * takes it down when it is not. The latest answer to "is there a match" is read
 * through a ref, so a re-render does not re-register the listener
 * (appendix P8.9).
 */
export function useCloseGuard(guard: CloseGuard): void {
  const latest = useRef(guard);
  latest.current = guard;

  useEffect(() => {
    if (!guard.window && !isDesktop()) {
      return;
    }
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const attach = (desktop: DesktopWindow): void => {
      if (cancelled) {
        return;
      }
      void installCloseGuard({
        window: desktop,
        inMatch: () => latest.current.inMatch,
        confirm: () => latest.current.confirm(),
        resign: () => latest.current.resign(),
      }).then(
        (stop) => {
          if (cancelled) {
            stop();
            return;
          }
          unlisten = stop;
        },
        () => undefined,
      );
    };

    if (guard.window) {
      attach(guard.window);
    } else {
      void loadWindow().then(attach, () => undefined);
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [guard.window]);
}
