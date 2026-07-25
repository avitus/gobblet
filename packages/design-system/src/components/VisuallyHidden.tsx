import type { ReactNode } from "react";
import styles from "./VisuallyHidden.module.css";

export type VisuallyHiddenProps = Readonly<{ children: ReactNode }>;

export function VisuallyHidden({ children }: VisuallyHiddenProps): React.JSX.Element {
  return <span className={styles.hidden}>{children}</span>;
}
