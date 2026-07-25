import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "../internal/class-names";
import styles from "./Dialog.module.css";

export type DialogProps = Readonly<{
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Omitted for a dialog the player must answer, such as a match result. */
  onClose?: () => void;
  className?: string;
  "data-testid"?: string;
}>;

export function Dialog({
  open,
  title,
  children,
  footer,
  onClose,
  className,
  "data-testid": testId,
}: DialogProps): React.JSX.Element | null {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || onClose === undefined) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        className={cx(styles.dialog, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
      >
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        <div className={styles.body}>{children}</div>
        {footer !== undefined && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
