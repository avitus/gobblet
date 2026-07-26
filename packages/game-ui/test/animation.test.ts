import { describe, expect, it } from "vitest";
import {
  ANIMATIONS,
  REDUCED_MOTION_CROSSFADE_MS,
  animationDurationMs,
  catchUpDurationMs,
  easeProgress,
} from "../src/scene/animation";

describe("the animation catalogue", () => {
  it("covers every animation section 13.4 requires", () => {
    expect(Object.keys(ANIMATIONS).sort()).toEqual(
      [
        "boardMove",
        "gobbleDescent",
        "hover",
        "matchFound",
        "ratingChange",
        "reserveMove",
        "resignation",
        "reveal",
        "selectionLift",
        "timeout",
        "winningLine",
      ].sort(),
    );
  });

  it("uses the durations appendix P5.10 fixes", () => {
    expect(animationDurationMs("hover", "full")).toBe(90);
    expect(animationDurationMs("selectionLift", "full")).toBe(90);
    expect(animationDurationMs("boardMove", "full")).toBe(220);
    expect(animationDurationMs("reserveMove", "full")).toBe(220);
    expect(animationDurationMs("gobbleDescent", "full")).toBe(260);
    expect(animationDurationMs("winningLine", "full")).toBe(400);
    expect(animationDurationMs("matchFound", "full")).toBe(600);
  });

  it("replaces every movement with one short cross-fade under reduced motion", () => {
    for (const name of Object.keys(ANIMATIONS) as (keyof typeof ANIMATIONS)[]) {
      expect(animationDurationMs(name, "reduced")).toBe(REDUCED_MOTION_CROSSFADE_MS);
    }
  });

  it("shortens and then skips animation while catching up", () => {
    expect(catchUpDurationMs("boardMove", "full", 1)).toBe(220);
    expect(catchUpDurationMs("boardMove", "full", 2)).toBe(110);
    expect(catchUpDurationMs("boardMove", "full", 3)).toBe(73);
    expect(catchUpDurationMs("boardMove", "full", 4)).toBe(0);
    expect(catchUpDurationMs("boardMove", "reduced", 3)).toBe(27);
  });

  it("eases progress, and moves linearly under reduced motion", () => {
    expect(easeProgress(0, "full")).toBe(0);
    expect(easeProgress(1, "full")).toBe(1);
    expect(easeProgress(0.25, "full")).toBeCloseTo(0.125, 6);
    expect(easeProgress(0.75, "full")).toBeCloseTo(0.875, 6);
    expect(easeProgress(0.4, "reduced")).toBe(0.4);
    expect(easeProgress(-1, "full")).toBe(0);
    expect(easeProgress(2, "reduced")).toBe(1);
  });
});
