import { Button, Dialog } from "@gobblet/design-system";
import { useCallback, useEffect, useState } from "react";
import { clientConfig } from "../config";
import { useTelemetry } from "../telemetry/provider";
import { loadUpdater, type UpdaterBridge } from "./bridge";
import { isDesktop } from "./host";
import { createUpdateClient, type UpdateClient } from "./update-client";

/**
 * The player's side of an update: a question, then a progress note while the
 * bundle installs, then a relaunch. It renders nothing in a browser and nothing
 * on the desktop until an update is actually offered (appendix P8.7).
 */

export type DesktopUpdatesProps = Readonly<{
  /** Supplied by the tests; the desktop loads the real one on mount. */
  bridge?: UpdaterBridge;
}>;

type Offer = Readonly<{ version: string; answer: (install: boolean) => void }>;

export function DesktopUpdates({ bridge }: DesktopUpdatesProps): React.JSX.Element | null {
  const telemetry = useTelemetry();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [installing, setInstalling] = useState(false);

  const confirm = useCallback(
    (version: string) =>
      new Promise<boolean>((resolve) => {
        setOffer({
          version,
          answer: (install) => {
            setOffer(null);
            setInstalling(install);
            resolve(install);
          },
        });
      }),
    [],
  );

  useEffect(() => {
    if (!bridge && !isDesktop()) {
      return;
    }
    let client: UpdateClient | null = null;
    let cancelled = false;

    const begin = (updater: UpdaterBridge): void => {
      if (cancelled) {
        return;
      }
      client = createUpdateClient({
        updater,
        currentVersion: clientConfig.clientVersion,
        confirm,
        report: (report) => {
          setInstalling(false);
          telemetry.capture({ name: "desktop-update-completed", ...report });
        },
      });
      client.start();
    };

    if (bridge) {
      begin(bridge);
    } else {
      void loadUpdater().then(begin, () => undefined);
    }

    return () => {
      cancelled = true;
      client?.stop();
    };
  }, [bridge, confirm, telemetry]);

  if (offer === null && !installing) {
    return null;
  }

  return (
    <Dialog
      open
      title={offer === null ? "Installing the update" : `Version ${offer.version} is available`}
      data-testid="update-dialog"
      footer={
        offer === null ? null : (
          <>
            <Button
              onClick={() => {
                offer.answer(true);
              }}
              data-testid="install-update"
            >
              Install and restart
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                offer.answer(false);
              }}
              data-testid="postpone-update"
            >
              Not now
            </Button>
          </>
        )
      }
    >
      {offer === null ? (
        <p data-testid="update-installing">
          The download is verified before anything is replaced. The window will restart itself.
        </p>
      ) : (
        <p data-testid="update-offer">
          You are running {clientConfig.clientVersion}. Installing takes a moment and restarts the
          window.
        </p>
      )}
    </Dialog>
  );
}
