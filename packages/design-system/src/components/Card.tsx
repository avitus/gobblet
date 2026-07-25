import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../internal/class-names";
import styles from "./Card.module.css";

export type CardProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  children?: ReactNode;
};

export function Card({
  title,
  description,
  actions,
  compact = false,
  className,
  children,
  ...rest
}: CardProps): React.JSX.Element {
  return (
    <section {...rest} className={cx(styles.card, compact && styles.compact, className)}>
      {(title !== undefined || actions !== undefined) && (
        <header className={styles.header}>
          {title !== undefined && <h2 className={styles.title}>{title}</h2>}
          {actions}
        </header>
      )}
      {description !== undefined && <p className={styles.description}>{description}</p>}
      {children !== undefined && <div className={styles.body}>{children}</div>}
    </section>
  );
}
