import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { cx } from "../internal/class-names";
import styles from "./Field.module.css";

export type SelectOption = Readonly<{ value: string; label: string }>;

export type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "children"> & {
  label: ReactNode;
  options: readonly SelectOption[];
  hint?: ReactNode;
  id?: string;
};

export function SelectField({
  label,
  options,
  hint,
  id,
  className,
  ...rest
}: SelectFieldProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
      </label>
      <select
        {...rest}
        id={fieldId}
        className={styles.control}
        aria-describedby={hint === undefined ? undefined : hintId}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== undefined && (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}
