import { describe, expect, it } from "vitest";
import {
  CAMERA_AZIMUTH_LIMIT_DEGREES,
  CAMERA_BASE_DISTANCE,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  CAMERA_POLAR_DEGREES,
  CAMERA_TARGET_PULL,
  clampOrbit,
  nudgeOrbit,
  placeCamera,
} from "../src/scene/camera";
import type { CameraPlacement } from "../src/scene/camera";

function offset(placement: CameraPlacement): readonly [number, number, number] {
  return [
    placement.position[0] - placement.target[0],
    placement.position[1] - placement.target[1],
    placement.position[2] - placement.target[2],
  ];
}

function distance(placement: CameraPlacement): number {
  const [x, y, z] = offset(placement);
  return Math.hypot(x, y, z);
}

function polarDegrees(placement: CameraPlacement): number {
  return (Math.acos(offset(placement)[1] / distance(placement)) * 180) / Math.PI;
}

describe("the constrained camera", () => {
  it("keeps the documented polar angle and distance at rest", () => {
    const placement = placeCamera("light");

    expect(polarDegrees(placement)).toBeCloseTo(CAMERA_POLAR_DEGREES, 6);
    expect(distance(placement)).toBeCloseTo(CAMERA_BASE_DISTANCE, 6);
  });

  it("looks past the board centre towards the seated player's own reserve", () => {
    const light = placeCamera("light");
    const dark = placeCamera("dark");

    expect(light.target[1]).toBe(0);
    expect(light.target[2]).toBeCloseTo(CAMERA_TARGET_PULL, 6);
    expect(dark.target[2]).toBeCloseTo(-CAMERA_TARGET_PULL, 6);
  });

  it("seats dark opposite light so the local reserve is nearest", () => {
    const light = placeCamera("light");
    const dark = placeCamera("dark");

    expect(light.position[2]).toBeGreaterThan(0);
    expect(dark.position[2]).toBeLessThan(0);
    expect(polarDegrees(dark)).toBeCloseTo(CAMERA_POLAR_DEGREES, 6);
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

    const orbited = placeCamera("light", { azimuthDegrees: 12, zoom: 1.1 });
    expect(orbited.target[1]).toBe(0);
    expect(Math.hypot(orbited.target[0], orbited.target[2])).toBeCloseTo(CAMERA_TARGET_PULL, 6);
  });

  it("moves the camera closer as the player zooms in", () => {
    const near = placeCamera("light", { azimuthDegrees: 0, zoom: CAMERA_MAX_ZOOM });
    const far = placeCamera("light", { azimuthDegrees: 0, zoom: CAMERA_MIN_ZOOM });

    expect(distance(near)).toBeLessThan(CAMERA_BASE_DISTANCE);
    expect(distance(far)).toBeGreaterThan(CAMERA_BASE_DISTANCE);
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
