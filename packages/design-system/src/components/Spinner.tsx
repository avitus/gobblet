import { cx } from "../internal/class-names";
import { VisuallyHidden } from "./VisuallyHidden";
import styles from "./Spinner.module.css";

export type SpinnerProps = Readonly<{
  label: string;
  className?: string;
}>;

export function Spinner({ label, className }: SpinnerProps): React.JSX.Element {
  return (
    <span role="status">
      <span aria-hidden="true" className={cx(styles.spinner, className)} />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
