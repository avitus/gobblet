/**
 * `@gobblet/design-system` holds the design tokens and the interface primitives
 * every client surface is built from (ADR-0013). It is browser-only and is
 * consumed as TypeScript source (ADR-0024): it contains no game rule, no
 * network call and no match state.
 */

export { Badge, type BadgeProps, type BadgeTone } from "./components/Badge";
export { Banner, type BannerProps, type BannerTone } from "./components/Banner";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./components/Button";
export { Card, type CardProps } from "./components/Card";
export { Dialog, type DialogProps } from "./components/Dialog";
export { RangeField, type RangeFieldProps } from "./components/RangeField";
export { SelectField, type SelectFieldProps, type SelectOption } from "./components/SelectField";
export { Spinner, type SpinnerProps } from "./components/Spinner";
export { SwitchField, type SwitchFieldProps } from "./components/SwitchField";
export { TextField, type TextFieldProps } from "./components/TextField";
export { VisuallyHidden, type VisuallyHiddenProps } from "./components/VisuallyHidden";
export { cx, type ClassValue } from "./internal/class-names";
export {
  REDUCED_MOTION_QUERY,
  useMediaQuery,
  usePrefersReducedMotion,
} from "./hooks/use-media-query";
