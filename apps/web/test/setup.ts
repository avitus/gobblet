import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom has no graphics context, so capability detection answers as a browser
 * without WebGL does and the board renders its flat tier (docs/adr/0023). The WebGL
 * tiers are covered by the browser suite instead.
 */
HTMLCanvasElement.prototype.getContext = () => null;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
