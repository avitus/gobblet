import { APP_ENVIRONMENTS, type AppEnvironment } from "@gobblet/protocol";

/**
 * Build-time client configuration. Only `VITE_`-prefixed variables reach the
 * bundle, and everything else the client needs comes from `GET /v1/config` at
 * runtime so a rebuild is not required to change a server setting.
 */
export type ClientConfig = Readonly<{
  apiBaseUrl: string;
  socketUrl: string;
  clientVersion: string;
  appEnv: AppEnvironment;
}>;

function readAppEnv(raw: string | undefined): AppEnvironment {
  return APP_ENVIRONMENTS.find((candidate) => candidate === raw) ?? "local";
}

export function readClientConfig(env: ImportMetaEnv): ClientConfig {
  const apiBaseUrl = (env.VITE_API_BASE_URL ?? "http://localhost:4000").replace(/\/+$/, "");
  return {
    apiBaseUrl,
    socketUrl: (env.VITE_SOCKET_URL ?? apiBaseUrl).replace(/\/+$/, ""),
    clientVersion: env.VITE_CLIENT_VERSION ?? "0.1.0",
    appEnv: readAppEnv(env.VITE_APP_ENV),
  };
}

export const clientConfig = readClientConfig(import.meta.env);
