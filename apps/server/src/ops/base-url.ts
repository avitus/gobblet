/**
 * A base URL without a scheme cannot become one by waiting: `fetch` fails to parse it
 * identically on every attempt. A production release spent five minutes retrying
 * `gobblet-production.up.railway.app` sixty times because the variable holding it had
 * no `https://`, so the checks that decide whether a deploy worked now refuse the value
 * up front and say what a usable one looks like.
 */

export type BaseUrlVerdict = Readonly<
  { ok: true; baseUrl: string } | { ok: false; problem: string }
>;

export function checkBaseUrl(name: string, value: string | undefined): BaseUrlVerdict {
  if (value === undefined || value.trim() === "") {
    return { ok: false, problem: `${name} is required, for example https://api.example.com` };
  }

  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      problem: `${name} must be an absolute URL including the scheme, for example https://${trimmed}`,
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      problem: `${name} must be an http or https URL, not ${parsed.protocol.replace(":", "")}`,
    };
  }

  return { ok: true, baseUrl: trimmed.replace(/\/+$/, "") };
}
