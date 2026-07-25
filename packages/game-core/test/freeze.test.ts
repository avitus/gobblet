import { describe, expect, it } from "vitest";
import { deepFreeze } from "../src/freeze";

describe("deepFreeze", () => {
  it("returns primitives unchanged", () => {
    expect(deepFreeze(7)).toBe(7);
    expect(deepFreeze("wood")).toBe("wood");
    expect(deepFreeze(undefined)).toBeUndefined();
    expect(deepFreeze(null)).toBeNull();
  });

  it("freezes nested objects and arrays", () => {
    const value = deepFreeze({ board: { r0c0: ["L04"] }, ply: 1 });

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.board)).toBe(true);
    expect(Object.isFrozen(value.board.r0c0)).toBe(true);
    expect(() => {
      (value as { ply: number }).ply = 2;
    }).toThrow(TypeError);
  });

  it("tolerates null members and already frozen substructures", () => {
    const shared = Object.freeze({ shared: true });
    const value = deepFreeze({ missing: null, shared, nested: { shared } });

    expect(value.missing).toBeNull();
    expect(value.shared).toBe(shared);
    expect(Object.isFrozen(value.nested)).toBe(true);
  });

  it("is idempotent", () => {
    const value = { a: [1, 2, 3] };
    expect(deepFreeze(deepFreeze(value))).toBe(value);
    expect(Object.isFrozen(value.a)).toBe(true);
  });
});
