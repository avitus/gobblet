/** Offered time controls in seconds (docs/product-spec.md section 2.4). */
export const TIME_CONTROLS_SECONDS = Object.freeze([180, 300, 600, 900] as const);

export type TimeControlSeconds = (typeof TIME_CONTROLS_SECONDS)[number];

export function isTimeControlSeconds(value: unknown): value is TimeControlSeconds {
  return TIME_CONTROLS_SECONDS.some((seconds) => seconds === value);
}
