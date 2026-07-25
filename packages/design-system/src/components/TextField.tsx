import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "../internal/class-names";
import styles from "./Field.module.css";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
};

export function TextField({
  label,
  hint,
  error,
  id,
  className,
  ...rest
}: TextFieldProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = cx(hint !== undefined && hintId, error !== undefined && errorId);

  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
      </label>
      <input
        {...rest}
        id={fieldId}
        className={cx(styles.control, error !== undefined && styles.invalid)}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
      />
      {hint !== undefined && (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span className={styles.error} id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
