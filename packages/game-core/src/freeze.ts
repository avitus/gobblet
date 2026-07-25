/**
 * Recursively freezes plain data so callers cannot mutate a returned game state.
 * Already frozen objects are skipped, which keeps sharing of unchanged
 * substructures between successive states cheap.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
