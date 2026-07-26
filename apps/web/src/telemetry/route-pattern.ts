const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A path as the route it matched, so a report says where a failure happened without
 * naming the match or the account it happened to (spec section 17.2).
 */
export function routePattern(pathname: string): string {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return "/";
  }
  const named = segments.map((segment, index) => {
    if (UUID.test(segment)) {
      return ":id";
    }
    return segments[index - 1] === "profile" ? ":username" : segment;
  });
  return `/${named.join("/")}`;
}
