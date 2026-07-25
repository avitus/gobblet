import { useId, type ReactNode } from "react";
import { cx } from "../internal/class-names";
import styles from "./Field.module.css";

export type SwitchFieldProps = Readonly<{
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}>;

export function SwitchField({
  label,
  checked,
  onCheckedChange,
  hint,
  disabled = false,
  id,
  className,
}: SwitchFieldProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cx(styles.field, className)}>
      <div className={styles.row}>
        <label className={styles.label} htmlFor={fieldId}>
          {label}
        </label>
        <input
          className={styles.switch}
          type="checkbox"
          role="switch"
          id={fieldId}
          checked={checked}
          disabled={disabled}
          aria-describedby={hint === undefined ? undefined : hintId}
          onChange={(event) => {
            onCheckedChange(event.target.checked);
          }}
        />
      </div>
      {hint !== undefined && (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}
