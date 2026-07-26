/**
 * A page boundary as one opaque string. Both administrative listings page by a
 * moment and an id together, because two rows can share a moment and a boundary
 * must not depend on rows that arrive later
 * (docs/adr/0029-administration-is-a-role-on-the-account.md).
 */
export type AdminCursor = Readonly<{ at: number; id: string }>;

const SEPARATOR = ":";

export function encodeCursor(cursor: AdminCursor): string {
  return Buffer.from(`${cursor.at}${SEPARATOR}${cursor.id}`, "utf8").toString("base64url");
}

/** An unreadable cursor reads as the first page rather than as an error. */
export function decodeCursor(encoded: string | undefined): AdminCursor | null {
  if (encoded === undefined) {
    return null;
  }

  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  const separator = decoded.indexOf(SEPARATOR);
  if (separator <= 0) {
    return null;
  }

  const at = Number(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (!Number.isSafeInteger(at) || id.length === 0) {
    return null;
  }
  return { at, id };
}
