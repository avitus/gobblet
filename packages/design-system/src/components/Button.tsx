import type { ButtonHTMLAttributes } from "react";
import { cx } from "../internal/class-names";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Marks the button as waiting for a server answer: it disables and announces itself as busy. */
  busy?: boolean;
  block?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  block = false,
  type = "button",
  className,
  disabled,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      className={cx(styles.button, styles[variant], styles[size], block && styles.block, className)}
      disabled={disabled === true || busy}
      aria-busy={busy ? true : undefined}
    />
  );
}
