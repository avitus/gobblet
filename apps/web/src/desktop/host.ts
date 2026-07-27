/**
 * The one predicate that separates the two products. The bundle is identical
 * (docs/adr/0033-the-desktop-application-is-the-web-build-in-a-window.md); the
 * shell announces itself on the window object, so the browser build carries the
 * desktop code and never runs it.
 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** What the launch event reports, which is the only place the host is named. */
export function hostPlatform(): "web" | "desktop" {
  return isDesktop() ? "desktop" : "web";
}
