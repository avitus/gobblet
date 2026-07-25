import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../internal/class-names";
import styles from "./Banner.module.css";

export type BannerTone = "info" | "success" | "warning" | "error";

export type BannerProps = HTMLAttributes<HTMLDivElement> & {
  tone?: BannerTone;
  title?: ReactNode;
  children: ReactNode;
};

/**
 * An error tone announces itself assertively; the others are polite, because a
 * status change should not interrupt a player mid-turn.
 */
export function Banner({
  tone = "info",
  title,
  className,
  children,
  ...rest
}: BannerProps): React.JSX.Element {
  return (
    <div
      {...rest}
      role={tone === "error" ? "alert" : "status"}
      className={cx(styles.banner, styles[tone], className)}
    >
      <div className={styles.content}>
        {title !== undefined && <span className={styles.title}>{title}</span>}
        <span className={styles.message}>{children}</span>
      </div>
    </div>
  );
}
