import { describe, expect, it } from "vitest";
import {
  CAMERA_AZIMUTH_LIMIT_DEGREES,
  CAMERA_BASE_DISTANCE,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  CAMERA_POLAR_DEGREES,
  clampOrbit,
  nudgeOrbit,
  placeCamera,
} from "../src/scene/camera";

function distance(position: readonly [number, number, number]): number {
  return Math.hypot(position[0], position[1], position[2]);
}

function polarDegrees(position: readonly [number, number, number]): number {
  return (Math.acos(position[1] / distance(position)) * 180) / Math.PI;
}

describe("the constrained camera", () => {
  it("keeps the documented polar angle and distance at rest", () => {
    const placement = placeCamera("light");

    expect(polarDegrees(placement.position)).toBeCloseTo(CAMERA_POLAR_DEGREES, 6);
    expect(distance(placement.position)).toBeCloseTo(CAMERA_BASE_DISTANCE, 6);
    expect(placement.target).toEqual([0, 0, 0]);
  });

  it("seats dark opposite light so the local reserve is nearest", () => {
    const light = placeCamera("light");
    const dark = placeCamera("dark");

    expect(light.position[2]).toBeGreaterThan(0);
    expect(dark.position[2]).toBeLessThan(0);
    expect(polarDegrees(dark.position)).toBeCloseTo(CAMERA_POLAR_DEGREES, 6);
  });

  it("never pans and never leaves the orbit range", () => {
    expect(clampOrbit({ azimuthDegrees: 90, zoom: 4 })).toEqual({
      azimuthDegrees: CAMERA_AZIMUTH_LIMIT_DEGREES,
      zoom: CAMERA_MAX_ZOOM,
    });
    expect(clampOrbit({ azimuthDegrees: -90, zoom: 0.1 })).toEqual({
      azimuthDegrees: -CAMERA_AZIMUTH_LIMIT_DEGREES,
      zoom: CAMERA_MIN_ZOOM,
    });
    expect(clampOrbit({ azimuthDegrees: Number.NaN, zoom: Number.NaN })).toEqual({
      azimuthDegrees: -CAMERA_AZIMUTH_LIMIT_DEGREES,
      zoom: CAMERA_MIN_ZOOM,
    });
    expect(placeCamera("light", { azimuthDegrees: 12, zoom: 1.1 }).target).toEqual([0, 0, 0]);
  });

  it("moves the camera closer as the player zooms in", () => {
    const near = placeCamera("light", { azimuthDegrees: 0, zoom: CAMERA_MAX_ZOOM });
    const far = placeCamera("light", { azimuthDegrees: 0, zoom: CAMERA_MIN_ZOOM });

    expect(distance(near.position)).toBeLessThan(CAMERA_BASE_DISTANCE);
    expect(distance(far.position)).toBeGreaterThan(CAMERA_BASE_DISTANCE);
  });

  it("accumulates a gesture without escaping the range", () => {
    const orbit = nudgeOrbit({ azimuthDegrees: 15, zoom: 1 }, { azimuthDegrees: 10, zoom: 0.5 });

    expect(orbit).toEqual({
      azimuthDegrees: CAMERA_AZIMUTH_LIMIT_DEGREES,
      zoom: CAMERA_MAX_ZOOM,
    });
    expect(nudgeOrbit(orbit, {})).toEqual(orbit);
  });
});
