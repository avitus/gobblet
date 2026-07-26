import type { Player } from "@gobblet/protocol";

/**
 * The constrained camera of section 13.1, with the limits appendix P5.3 fixes: a
 * single polar angle, a small azimuth range, a small zoom range and no panning.
 */
export const CAMERA_POLAR_DEGREES = 55;
export const CAMERA_AZIMUTH_LIMIT_DEGREES = 18;
export const CAMERA_MIN_ZOOM = 0.85;
export const CAMERA_MAX_ZOOM = 1.25;
export const CAMERA_BASE_DISTANCE = 9.2;
export const CAMERA_FIELD_OF_VIEW = 32;

export type CameraOrbit = Readonly<{
  /** Degrees either side of centre, positive towards the light player's right. */
  azimuthDegrees: number;
  zoom: number;
}>;

export type CameraPlacement = Readonly<{
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fieldOfView: number;
}>;

export const DEFAULT_ORBIT: CameraOrbit = Object.freeze({ azimuthDegrees: 0, zoom: 1 });

function clamp(value: number, minimum: number, maximum: number): number {
  if (Number.isNaN(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

/** Keeps an orbit inside the documented range, whatever the input device reports. */
export function clampOrbit(orbit: CameraOrbit): CameraOrbit {
  return {
    azimuthDegrees: clamp(
      orbit.azimuthDegrees,
      -CAMERA_AZIMUTH_LIMIT_DEGREES,
      CAMERA_AZIMUTH_LIMIT_DEGREES,
    ),
    zoom: clamp(orbit.zoom, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM),
  };
}

const RADIANS_PER_DEGREE = Math.PI / 180;

/**
 * Places the camera for the seat the local player holds. Dark turns the rig by
 * half a revolution so the local reserve is always nearest (appendix P5.3).
 */
export function placeCamera(seat: Player, orbit: CameraOrbit = DEFAULT_ORBIT): CameraPlacement {
  const { azimuthDegrees, zoom } = clampOrbit(orbit);
  const seatRotation = seat === "light" ? 0 : 180;
  const azimuth = (azimuthDegrees + seatRotation) * RADIANS_PER_DEGREE;
  const polar = CAMERA_POLAR_DEGREES * RADIANS_PER_DEGREE;
  const distance = CAMERA_BASE_DISTANCE / zoom;

  return {
    position: [
      distance * Math.sin(polar) * Math.sin(azimuth),
      distance * Math.cos(polar),
      distance * Math.sin(polar) * Math.cos(azimuth),
    ],
    target: [0, 0, 0],
    fieldOfView: CAMERA_FIELD_OF_VIEW,
  };
}

/** Applies a drag or wheel gesture to an orbit without leaving the allowed range. */
export function nudgeOrbit(
  orbit: CameraOrbit,
  change: Readonly<{ azimuthDegrees?: number; zoom?: number }>,
): CameraOrbit {
  return clampOrbit({
    azimuthDegrees: orbit.azimuthDegrees + (change.azimuthDegrees ?? 0),
    zoom: orbit.zoom + (change.zoom ?? 0),
  });
}
