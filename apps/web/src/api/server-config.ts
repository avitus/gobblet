export type PublicServerConfig = Readonly<{
  appEnv: string;
  appVersion: string;
  minSupportedClientVersion: string;
  modes: readonly string[];
  timeControlsSeconds: readonly number[];
}>;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

function isPublicServerConfig(value: unknown): value is PublicServerConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.appEnv === "string" &&
    typeof candidate.appVersion === "string" &&
    typeof candidate.minSupportedClientVersion === "string" &&
    Array.isArray(candidate.modes) &&
    Array.isArray(candidate.timeControlsSeconds) &&
    candidate.timeControlsSeconds.every((entry) => typeof entry === "number")
  );
}

/**
 * Reads the public configuration document (`GET /v1/config`). Phase 3 replaces the
 * hand written guard with the shared `@gobblet/protocol` schemas.
 */
export async function fetchServerConfig(signal?: AbortSignal): Promise<PublicServerConfig> {
  const response = await fetch(`${API_BASE_URL}/v1/config`, {
    headers: { accept: "application/json" },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`status ${String(response.status)}`);
  }

  const payload: unknown = await response.json();
  if (!isPublicServerConfig(payload)) {
    throw new Error("unexpected configuration payload");
  }

  return payload;
}
