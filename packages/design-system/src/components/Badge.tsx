import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../internal/class-names";
import styles from "./Badge.module.css";

export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "error";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  children: ReactNode;
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...rest
}: BadgeProps): React.JSX.Element {
  return (
    <span {...rest} className={cx(styles.badge, styles[tone], className)}>
      {children}
    </span>
  );
}
