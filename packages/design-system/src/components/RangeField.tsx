import { useId, type ReactNode } from "react";
import { cx } from "../internal/class-names";
import styles from "./Field.module.css";

export type RangeFieldProps = Readonly<{
  label: ReactNode;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  formatValue?: (value: number) => string;
  disabled?: boolean;
  id?: string;
  className?: string;
}>;

export function RangeField({
  label,
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.05,
  formatValue,
  disabled = false,
  id,
  className,
}: RangeFieldProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const displayed = formatValue === undefined ? value.toFixed(2) : formatValue(value);

  return (
    <div className={cx(styles.field, className)}>
      <div className={styles.row}>
        <label className={styles.label} htmlFor={fieldId}>
          {label}
        </label>
        <span className={styles.rangeValue}>{displayed}</span>
      </div>
      <input
        className={styles.range}
        type="range"
        id={fieldId}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onValueChange(Number(event.target.value));
        }}
      />
    </div>
  );
}
